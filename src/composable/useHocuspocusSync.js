import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { useAccountStore } from '@/store/account'
import { useWorkspaceStore } from '@/store/workspace'
import { getWorkspaceDoc } from './meta-yjs-doc.js'
import { registerActiveDoc, unregisterActiveDoc } from './yjs-shared.js'
import {
  importCollabKey,
  encryptUpdate,
  decryptUpdate,
  isValidCollabKey,
} from '@/utils/crypto/collab'
import { clearUnwrappedKeyCache } from '@/utils/crypto/note-key'

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

function buildMetaRoomName(workspaceId) {
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

export function useHocuspocusSync() {
  const accountStore = useAccountStore()
  const workspaceStore = useWorkspaceStore()

  let ws = null
  let heartbeatTimer = null
  let reconnectTimeout = null
  let reconnectDelay = RECONNECT_DELAY_MS
  let connected = false
  let messageQueue = Promise.resolve()

  const activeRooms = new Map()
  const pendingQueue = []

  function getWebSocketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const hocuspocusHost =
      import.meta.env.VITE_HOCUSPOCUS_URL || window.location.host
    return `${protocol}//${hocuspocusHost}/hocuspocus`
  }

  function isAuthenticated() {
    return (
      accountStore.status === 'authenticated' && !!accountStore.token
    )
  }

  function getActiveWorkspaceId() {
    return workspaceStore.activeId
  }

  function sendBinary(buffer) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      pendingQueue.push(buffer)
      return
    }
    pendingQueue.push(buffer)
    flushPending()
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
    const payload = new TextEncoder().encode(json)
    const buf = new Uint8Array(payload.length)
    buf.set(payload)
    sendBinary(buf.buffer)
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
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  async function broadcastUpdate(update, origin, doc) {
    if (
      origin === 'hocuspocus' ||
      origin === 'load' ||
      origin === 'sync'
    )
      return

    const roomName = [...activeRooms.keys()].find(
      (name) => activeRooms.get(name)?.doc === doc,
    )
    if (!roomName) return

    const encoder = encoding.createEncoder()
    syncProtocol.writeUpdate(encoder, update)
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

  function joinNoteRoom(noteId, doc) {
    const workspaceId = getActiveWorkspaceId()
    if (!workspaceId) return

    const roomName = buildRoomName(workspaceId, noteId)
    if (activeRooms.has(roomName)) return

    activeRooms.set(roomName, { doc, readOnly: false })
    registerActiveDoc(noteId, doc)

    doc.on('update', (update, origin) => {
      broadcastUpdate(update, origin, doc)
    })

    if (localAwareness) {
      localAwareness.on('update', broadcastAwareness)
    }

    if (connected && doc) {
      const encoder = encoding.createEncoder()
      syncProtocol.writeSyncStep1(encoder, doc)
      sendBinary(encoding.toUint8Array(encoder).buffer)
    }
  }

  /**
   * Leave a note's collaboration room and unregister its doc.
   * Called when the note is closed/switched so stale rooms (and their
   * destroyed Y.Docs) do not accumulate in `activeRooms` and get re-parsed on
   * every inbound WebSocket message.
   */
  function leaveNoteRoom(noteId) {
    const roomName = buildRoomName(getActiveWorkspaceId() || '', noteId)
    activeRooms.delete(roomName)
    unregisterActiveDoc(noteId)
  }

  function joinMetaRoom(workspaceId) {
    const roomName = buildMetaRoomName(workspaceId)
    if (activeRooms.has(roomName)) return

    const doc = getWorkspaceDoc()
    activeRooms.set(roomName, { doc, readOnly: false })

    doc.on('update', (update, origin) => {
      broadcastUpdate(update, origin, doc)
    })

    if (localAwareness) {
      localAwareness.on('update', broadcastAwareness)
    }

    if (connected && doc) {
      const encoder = encoding.createEncoder()
      syncProtocol.writeSyncStep1(encoder, doc)
      sendBinary(encoding.toUint8Array(encoder).buffer)
    }
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
    }

    ws.onmessage = (event) => {
      messageQueue = messageQueue.then(() => handleServerMessage(event.data))
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
    collabKeys.clear()
    clearUnwrappedKeyCache()
    pendingQueue.length = 0
  }

  function start() {
    if (!isAuthenticated()) return
    connect()
  }

  function handleWorkspaceSwitch(workspaceId) {
    for (const [roomName] of activeRooms) {
      if (roomName.startsWith('workspace:')) {
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
    activeRooms.set(roomName, { doc, readOnly: false })

    doc.on('update', (update, origin) => {
      broadcastUpdate(update, origin, doc)
    })

    if (localAwareness) {
      localAwareness.on('update', broadcastAwareness)
    }

    if (connected && doc) {
      const encoder = encoding.createEncoder()
      syncProtocol.writeSyncStep1(encoder, doc)
      sendBinary(encoding.toUint8Array(encoder).buffer)
    }
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