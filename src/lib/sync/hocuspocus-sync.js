import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as Y from 'yjs'
import { useAccountStore } from '@/store/account'
import { useWorkspaceStore } from '@/store/workspace'
import { getWorkspaceDoc } from '@/lib/yjs/meta-doc'
import { registerActiveDoc, unregisterActiveDoc } from '@/lib/yjs/shared'
import {
  importCollabKey,
  encryptUpdate,
  decryptUpdate,
  isValidCollabKey,
} from '@/utils/crypto/collab'
import { clearUnwrappedKeyCache, unwrapNoteKey } from '@/utils/crypto/note-key'
import { loadOrCreateIdentity } from '@/utils/crypto/identity'
import { getWorkspaceKey, getCachedWorkspaceKey } from '@/lib/api/workspaces'

// Collaboration keys per room (roomName -> CryptoKey)
const collabKeys = new Map()

// Awareness instance (set per-room via setAwareness)
let localAwareness = null

const HEARTBEAT_INTERVAL_MS = 25000
const RECONNECT_DELAY_MS = 3000
const MAX_RECONNECT_DELAY_MS = 30000

function buildRoomName(workspaceId, noteId) {
  return `workspace:${workspaceId}:note:${noteId}`
}

export function buildMetaRoomName(workspaceId) {
  return `workspace:${workspaceId}:meta`
}

export async function setRoomKey(roomName, hexKey) {
  if (!isValidCollabKey(hexKey)) {
    console.warn('[hocuspocus] invalid collab key for room', roomName)
    return
  }
  try {
    const key = await importCollabKey(hexKey)
    collabKeys.set(roomName, key)
  } catch (err) {
    console.error('[hocuspocus] failed to import collab key:', err)
  }
}

export function setAwareness(awareness) {
  localAwareness = awareness
}

/**
 * Derive the workspace key and register it on the Hocuspocus meta room so
 * inbound meta updates can be decrypted. Mirrors the per-note key wiring in
 * useNoteYjs.js (setRoomKey around useNoteYjs.js:230) but uses the WORKSPACE
 * key rather than a per-note key.
 *
 * The key is preferred from the local workspace-key cache (seeded at creation
 * or after vault-passphrase recovery — no network), then from the workspace
 * store's wrapped key, falling back to an API fetch via getWorkspaceKey(wsId).
 */
export async function ensureMetaRoomKey(workspaceId) {
  if (!workspaceId) return
  const cachedHex = getCachedWorkspaceKey(workspaceId)
  if (cachedHex) {
    await setRoomKey(buildMetaRoomName(workspaceId), cachedHex)
    return
  }
  const workspaceStore = useWorkspaceStore()
  const ws =
    workspaceStore.activeWorkspace ||
    workspaceStore.workspaces?.find((w) => w.id === workspaceId)
  let wrappedKey = ws?.wrappedKey ?? null
  if (!wrappedKey) {
    wrappedKey = await getWorkspaceKey(workspaceId)
  }
  if (!wrappedKey) {
    console.warn('[hocuspocus] no wrapped key available for workspace', workspaceId)
    return
  }
  const identity = await loadOrCreateIdentity()
  if (!identity?.privateKeyHex) {
    console.warn('[hocuspocus] missing encryption identity for meta key')
    return
  }
  const workspaceKeyHex = await unwrapNoteKey(identity.privateKeyHex, wrappedKey)
  await setRoomKey(buildMetaRoomName(workspaceId), workspaceKeyHex)
}

export function getWebSocketUrl() {
  const accountStore = useAccountStore()
  const configured =
    import.meta.env.VITE_BEAVER_SYNC_WS_URL ||
    import.meta.env.VITE_HOCUSPOCUS_URL
  let base
  if (configured) {
    base = configured.replace(/\/+$/, '')
  } else {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    base = `${protocol}//${window.location.host}`
  }
  const token = accountStore.token
  const query = token ? `?token=${encodeURIComponent(token)}` : ''
  return query ? `${base}/${query}` : base
}

function isAuthenticated() {
  const accountStore = useAccountStore()
  return accountStore.status === 'authenticated' && !!accountStore.token
}

export function useHocuspocusSync() {
  const workspaceStore = useWorkspaceStore()

  let ws = null
  let heartbeatTimer = null
  let reconnectTimeout = null
  let reconnectDelay = RECONNECT_DELAY_MS
  let connected = false
  let messageQueue = Promise.resolve()

  const activeRooms = new Map()
  const docToRoom = new Map() // reverse index: Y.Doc -> roomName (O(1) broadcast lookup)
  const pendingQueue = []

  function getActiveWorkspaceId() {
    return workspaceStore.activeId
  }

  function sendBinary(buffer) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      pendingQueue.push(buffer)
      return
    }
    try {
      ws.send(buffer)
    } catch {
      pendingQueue.push(buffer)
    }
  }

  function flushPending() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    while (pendingQueue.length > 0) {
      const buf = pendingQueue.shift()
      try {
        ws.send(buf)
      } catch {
        pendingQueue.unshift(buf)
        break
      }
    }
  }

  function sendStateless(json) {
    sendBinary(new TextEncoder().encode(json).buffer)
  }

  async function handleServerMessage(buffer) {
    const data =
      buffer instanceof Uint8Array
        ? buffer
        : new Uint8Array(buffer)

    if (data.length === 0) return

    const msg = decoding.createDecoder(data)

    while (decoding.hasContent(msg)) {
      const messageType = decoding.readVarUint(msg)

      switch (messageType) {
        case 0: {
          // Sync message — read sub-type
          const syncType = decoding.readVarUint(msg)
          switch (syncType) {
            case 0: {
              // syncStep1 — server sends state vector, we reply with syncStep2
              for (const [, room] of activeRooms) {
                if (!room.doc) continue
                try {
                  const encoder = encoding.createEncoder()
                  syncProtocol.readSyncStep1(msg, encoder, room.doc)
                  sendBinary(encoding.toUint8Array(encoder).buffer)
                } catch (err) {
                  console.warn(
                    '[hocuspocus] Failed to handle sync step 1:',
                    err.message,
                  )
                }
              }
              break
            }
            case 1: {
              // syncStep2 — apply update to doc
              for (const [, room] of activeRooms) {
                if (!room.doc) continue
                try {
                  syncProtocol.readSyncStep2(msg, room.doc, 'hocuspocus')
                } catch (err) {
                  console.warn(
                    '[hocuspocus] Failed to apply sync step 2:',
                    err.message,
                  )
                }
              }
              break
            }
            case 2: {
              // sync update — apply encrypted or plain update to doc
              for (const [roomName, room] of activeRooms) {
                if (!room.doc) continue
                try {
                  const key = collabKeys.get(roomName)
                  if (key) {
                    const aad = roomName
                    const encryptedData = decoding.readVarUint8Array(msg)
                    const decryptedData = await decryptUpdate(
                      key,
                      new Uint8Array(encryptedData),
                      aad,
                    )
                    syncProtocol.readUpdate(
                      decoding.createDecoder(decryptedData),
                      room.doc,
                      'hocuspocus',
                    )
                  } else {
                    // No collab key for this room. Workspace rooms
                    // (note + meta) are ALWAYS encrypted, so a missing key
                    // means we cannot decrypt — applying the raw ciphertext
                    // would corrupt the Y.Doc (e.g. blank notes grid).
                    // Skip rather than corrupt. Non-workspace rooms (if any)
                    // fall back to the previous plaintext behavior.
                    if (roomName.startsWith('workspace:')) {
                      console.warn(
                        `[hocuspocus] dropping encrypted update for ${roomName}: no room key set`,
                      )
                      continue
                    }
                    syncProtocol.readUpdate(
                      msg,
                      room.doc,
                      'hocuspocus',
                    )
                  }
                } catch (err) {
                  console.warn(
                    '[hocuspocus] Failed to apply update:',
                    err.message,
                  )
                }
              }
              break
            }
            default:
              console.warn(
                `[hocuspocus] Unknown sync sub-type: ${syncType}`,
              )
          }
          break
        }
        case 1: {
          // Query awareness — server asks for our awareness state
          if (localAwareness) {
            try {
              const update = awarenessProtocol.encodeAwarenessUpdate(
                localAwareness,
                [localAwareness.clientID],
              )
              const encoder = encoding.createEncoder()
              encoding.writeVarUint(encoder, 2)
              encoding.writeVarUint8Array(encoder, update)
              sendBinary(encoding.toUint8Array(encoder).buffer)
            } catch (err) {
              console.warn(
                '[hocuspocus] Failed to respond to awareness query:',
                err.message,
              )
            }
          }
          break
        }
        case 2: {
          // Awareness update — apply to local awareness
          if (localAwareness) {
            try {
              const update = decoding.readVarUint8Array(msg)
              awarenessProtocol.applyAwarenessUpdate(
                localAwareness,
                update,
                'hocuspocus',
              )
            } catch (err) {
              console.warn(
                '[hocuspocus] Failed to apply awareness update:',
                err.message,
              )
            }
          } else {
            decoding.readVarUint8Array(msg)
          }
          break
        }
        case 3: {
          const jsonStr = decoding.readVarString(msg)
          handleStatelessMessage(jsonStr)
          break
        }
        default:
          console.warn(
            `[hocuspocus] Unknown message type: ${messageType}`,
          )
      }
    }
  }

  function handleStatelessMessage(jsonStr) {
    try {
      const msg = JSON.parse(jsonStr)
      if (msg.type === 'auth') {
        for (const [, room] of activeRooms) {
          room.readOnly = msg.readOnly === true
          room.role = msg.role || (msg.readOnly ? 'viewer' : 'editor')
        }
      } else if (msg.type === 'notification') {
        // Server notified us that another device pushed updates for the
        // given noteIds.  Trigger an immediate sync pull instead of
        // waiting for the next 30-second timer tick.  fire-and-forget.
        import('@/utils/sync/engine').then(({ forceSyncNow }) => {
          forceSyncNow().catch(() => {})
        }).catch(() => {})
      }
    } catch {
      // ignore parse errors
    }
  }

  // Coalesce doc updates before broadcasting. A keystroke fires one Y.Doc
  // update event each, so fast typing produced a separate encode + (optional)
  // AES-GCM WebCrypto call + websocket send per keystroke. Buffer per room and
  // merge with the same 120 ms window — indistinguishable for remote peers but
  // a fraction of the crypto/encode/send work. Awareness stays immediate.
  const BROADCAST_DEBOUNCE_MS = 120
  const broadcastBuffers = new Map()

  function scheduleBroadcast(roomName, update) {
    let entry = broadcastBuffers.get(roomName)
    if (!entry) {
      entry = { updates: [], timer: null }
      broadcastBuffers.set(roomName, entry)
    }
    entry.updates.push(update)
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      entry.timer = null
      const updates = entry.updates.splice(0)
      if (updates.length === 0) return
      const merged = Y.mergeUpdates(updates)
      if (merged.byteLength === 0) return
      flushBroadcast(roomName, merged)
    }, BROADCAST_DEBOUNCE_MS)
  }

  function dropPendingBroadcast(roomName) {
    const entry = broadcastBuffers.get(roomName)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    broadcastBuffers.delete(roomName)
  }

  async function flushBroadcast(roomName, merged) {
    const encoder = encoding.createEncoder()
    syncProtocol.writeUpdate(encoder, merged)
    let payload = encoding.toUint8Array(encoder)

    // Encrypt if collaboration key is available
    const key = collabKeys.get(roomName)
    if (key) {
      try {
        const aad = roomName
        payload = await encryptUpdate(key, payload, aad)
      } catch (err) {
        console.error('[hocuspocus] encryption failed:', err)
        return
      }
    }

    sendBinary(payload.buffer)
  }

  function broadcastUpdate(update, origin, doc) {
    if (
      origin === 'hocuspocus' ||
      origin === 'load' ||
      origin === 'sync'
    )
      return

    const roomName = docToRoom.get(doc)
    if (!roomName) return

    scheduleBroadcast(roomName, update)
  }

  function broadcastAwareness({ added, updated, removed }) {
    if (!localAwareness) return
    const changedClients = added.concat(updated).concat(removed)
    if (changedClients.length === 0) return
    const update = awarenessProtocol.encodeAwarenessUpdate(
      localAwareness,
      changedClients,
    )
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, 2)
    encoding.writeVarUint8Array(encoder, update)
    sendBinary(encoding.toUint8Array(encoder).buffer)
  }

  function attachRoomHandlers(doc) {
    doc.on('update', (update, origin) => {
      broadcastUpdate(update, origin, doc)
    })
    if (localAwareness) {
      localAwareness.on('update', broadcastAwareness)
    }
  }

  function requestInitialSync(doc) {
    if (connected && doc) {
      const encoder = encoding.createEncoder()
      syncProtocol.writeSyncStep1(encoder, doc)
      sendBinary(encoding.toUint8Array(encoder).buffer)
    }
  }

  function joinNoteRoom(noteId, doc) {
    const workspaceId = getActiveWorkspaceId()
    if (!workspaceId) return

    const roomName = buildRoomName(workspaceId, noteId)
    if (activeRooms.has(roomName)) return

    activeRooms.set(roomName, { doc, readOnly: false, role: 'editor' })
    docToRoom.set(doc, roomName)
    registerActiveDoc(noteId, doc)

    attachRoomHandlers(doc)
    requestInitialSync(doc)
  }

  /**
   * Leave a note's collaboration room and unregister its doc.
   * Called when the note is closed/switched so stale rooms (and their
   * destroyed Y.Docs) do not accumulate in `activeRooms` and get re-parsed on
   * every inbound WebSocket message.
   */
  function leaveNoteRoom(noteId) {
    const roomName = buildRoomName(getActiveWorkspaceId() || '', noteId)
    const room = activeRooms.get(roomName)
    if (room?.doc) docToRoom.delete(room.doc)
    activeRooms.delete(roomName)
    dropPendingBroadcast(roomName)
    unregisterActiveDoc(noteId)
  }

  function joinMetaRoom(workspaceId) {
    const roomName = buildMetaRoomName(workspaceId)
    if (activeRooms.has(roomName)) return

    const doc = getWorkspaceDoc()

    // Register the doc/room BEFORE deriving the key so any inbound messages
    // are routed, then ensure the workspace key is set before we request the
    // initial sync. The meta doc is encrypted with the WORKSPACE key; without
    // it inbound meta updates are dropped/applied as ciphertext and the notes
    // grid goes blank on secondary devices.
    activeRooms.set(roomName, { doc, readOnly: false, role: 'editor' })
    docToRoom.set(doc, roomName)

    attachRoomHandlers(doc)
    // Fire-and-forget: key derivation (ML-KEM) is fast and the WebSocket
    // round-trip is slower, so the key is virtually always set before the
    // server's sync reply is processed. If it fails we still join the room.
    ensureMetaRoomKey(workspaceId).catch((err) => {
      console.warn('[hocuspocus] meta room key not set:', err?.message || err)
    })
    requestInitialSync(doc)
  }

  function connect() {
    if (ws) return
    if (!isAuthenticated()) return

    const url = getWebSocketUrl()
    ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'

    ws.onopen = () => {
      connected = true
      reconnectDelay = RECONNECT_DELAY_MS
      console.warn('[hocuspocus] Connected')

      heartbeatTimer = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          sendStateless(JSON.stringify({ type: 'ping' }))
        }
      }, HEARTBEAT_INTERVAL_MS)

      for (const [, room] of activeRooms) {
        if (room.doc) {
          const encoder = encoding.createEncoder()
          syncProtocol.writeSyncStep1(encoder, room.doc)
          sendBinary(encoding.toUint8Array(encoder).buffer)
        }
      }

      flushPending()

      // Trigger an immediate HTTP pull to fetch any updates that arrived
      // while this device was offline.  Notifications missed during the
      // offline window are not replayed, so without this pull the device
      // would stay stale until the user foregrounds the app.
      import('@/utils/sync/engine').then(({ forceSyncNow }) => {
        forceSyncNow().catch(() => {})
      }).catch(() => {})
    }

    ws.onmessage = (event) => {
      messageQueue = messageQueue.then(
        () => handleServerMessage(event.data),
        () => {} // prevent one failed message from killing the queue
      )
    }

    ws.onclose = () => {
      connected = false
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }

      if (reconnectTimeout) clearTimeout(reconnectTimeout)
      reconnectTimeout = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
        connect()
      }, reconnectDelay)
    }

    ws.onerror = () => {
      // onclose fires after onerror, reconnect logic is in onclose
    }
  }

  function disconnect() {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout)
      reconnectTimeout = null
    }
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    if (ws) {
      ws.onclose = null
      ws.onmessage = null
      ws.onerror = null
      ws.onopen = null
      ws.close()
      ws = null
    }
    connected = false
    activeRooms.clear()
    docToRoom.clear()
    collabKeys.clear()
    clearUnwrappedKeyCache()
    for (const [, entry] of broadcastBuffers) {
      if (entry.timer) clearTimeout(entry.timer)
    }
    broadcastBuffers.clear()
    pendingQueue.length = 0
  }

  function start() {
    if (!isAuthenticated()) return
    connect()
  }

  function handleWorkspaceSwitch(workspaceId) {
    for (const [roomName, room] of activeRooms) {
      if (roomName.startsWith('workspace:')) {
        if (room?.doc) docToRoom.delete(room.doc)
        activeRooms.delete(roomName)
      }
    }

    if (connected) {
      joinMetaRoom(workspaceId)
    }
  }

  function handleNoteSwitch(noteId, doc) {
    for (const [roomName] of activeRooms) {
      if (roomName.endsWith(`:note:${noteId}`)) return
    }

    const workspaceId = getActiveWorkspaceId()
    if (!workspaceId) return

    const roomName = buildRoomName(workspaceId, noteId)
    activeRooms.set(roomName, { doc, readOnly: false, role: 'editor' })
    docToRoom.set(doc, roomName)

    attachRoomHandlers(doc)
    requestInitialSync(doc)
  }

  function getRoomRole(noteId) {
    const workspaceId = getActiveWorkspaceId()
    if (!workspaceId) return 'editor'
    const roomName = buildRoomName(workspaceId, noteId)
    return activeRooms.get(roomName)?.role || 'editor'
  }

  return {
    start,
    stop: disconnect,
    connect,
    disconnect,
    joinNoteRoom,
    leaveNoteRoom,
    joinMetaRoom,
    handleWorkspaceSwitch,
    handleNoteSwitch,
    getRoomRole,
    get connected() {
      return connected
    },
  }
}

let hocuspocusInstance = null

export function getHocuspocusSync() {
  if (!hocuspocusInstance) {
    hocuspocusInstance = useHocuspocusSync()
  }
  return hocuspocusInstance
}