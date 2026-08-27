import { WebsocketProvider } from 'y-websocket'
import * as awarenessProtocol from 'y-protocols/awareness'
import { useAccountStore } from '@/store/account'
import { useWorkspaceStore } from '@/store/workspace'
import { getWorkspaceDoc } from '@/lib/yjs/meta-doc'
import { unregisterActiveDoc } from '@/lib/yjs/shared'
import {
  importCollabKey,
  isValidCollabKey,
} from '@/utils/crypto/collab'
import { clearUnwrappedKeyCache, unwrapNoteKey } from '@/utils/crypto/note-key'
import { loadOrCreateIdentity } from '@/utils/crypto/identity'
import { getWorkspaceKey, getCachedWorkspaceKey } from '@/lib/api/workspaces'
import { forceSyncNow } from '@/utils/sync/engine'

// Collaboration keys per room (roomName -> CryptoKey)
const collabKeys = new Map()

// Text notification listeners per provider — tracked for cleanup
const notificationListeners = new WeakMap()

/**
 * y-websocket's WebsocketProvider only handles binary messages (types 0-3).
 * The ws-relay server sends JSON text notifications via sendText() to signal
 * new data. Intercept these text messages on the raw WebSocket and trigger
 * a pull cycle so the client picks up the new updates.
 *
 * Re-attaches on reconnection since provider.ws is reassigned.
 */
function createNotificationHandler() {
  return (event) => {
    if (typeof event.data !== 'string') return
    try {
      const msg = JSON.parse(event.data)
      if (msg.type === 'notification') {
        console.warn('[ws-sync] notification from server, triggering sync')
        forceSyncNow().catch(() => {})
      }
    } catch {
      // Not JSON — ignore
    }
  }
}

function attachNotificationListener(provider) {
  detachNotificationListener(provider)
  const handler = createNotificationHandler()
  if (provider.ws) {
    provider.ws.addEventListener('message', handler)
  }
  notificationListeners.set(provider, handler)
}

function detachNotificationListener(provider) {
  const handler = notificationListeners.get(provider)
  if (handler && provider.ws) {
    provider.ws.removeEventListener('message', handler)
  }
  notificationListeners.delete(provider)
}

function buildRoomName(workspaceId, noteId) {
  return `workspace:${workspaceId}:note:${noteId}`
}

export function buildMetaRoomName(workspaceId) {
  return `workspace:${workspaceId}:meta`
}

export async function setRoomKey(roomName, hexKey) {
  if (!isValidCollabKey(hexKey)) {
    console.warn('[ws-sync] invalid collab key for room', roomName)
    return
  }
  try {
    const key = await importCollabKey(hexKey)
    collabKeys.set(roomName, key)
  } catch (err) {
    console.error('[ws-sync] failed to import collab key:', err)
  }
}

export function getWebSocketUrl() {
  const configured =
    import.meta.env.VITE_BEAVER_SYNC_WS_URL ||
    import.meta.env.VITE_HOCUSPOCUS_URL
  if (configured) {
    return configured.replace(/\/+$/, '')
  }
  // In production, the WS relay is behind the same domain as the API.
  // Caddy routes /ws/* to ws-relay. Derive WS URL from API URL.
  const apiBase =
    import.meta.env.VITE_BEAVER_SYNC_API_URL || 'http://localhost:4000'
  try {
    const u = new URL(apiBase)
    const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${wsProto}//${u.host}`
  } catch {
    return 'ws://localhost:8080'
  }
}

function getAuthToken() {
  return useAccountStore().token || ''
}

// One-time short-lived ticket so the session token never appears in the WS URL.
// Falls back to the raw token param against older backends without /auth/ws-ticket.
async function getWsParams(workspaceId) {
  const token = getAuthToken()
  if (!token) return {}
  try {
    const apiBase =
      import.meta.env.VITE_BEAVER_SYNC_API_URL || 'http://localhost:4000'
    const res = await fetch(`${apiBase.replace(/\/+$/, '')}/auth/ws-ticket`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(workspaceId ? { workspaceId } : {}),
    })
    if (res.ok) {
      const { ticket } = await res.json()
      if (ticket) return { ticket }
    }
  } catch {
    // fall through to legacy token param
  }
  return { token }
}

function isAuthenticated() {
  const accountStore = useAccountStore()
  return accountStore.status === 'authenticated' && !!accountStore.token
}

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
    console.warn('[ws-sync] no wrapped key available for workspace', workspaceId)
    return
  }
  const identity = await loadOrCreateIdentity()
  if (!identity?.privateKeyHex) {
    console.warn('[ws-sync] missing encryption identity for meta key')
    return
  }
  const workspaceKeyHex = await unwrapNoteKey(identity.privateKeyHex, wrappedKey)
  await setRoomKey(buildMetaRoomName(workspaceId), workspaceKeyHex)
}

export function useWsSync() {
  const workspaceStore = useWorkspaceStore()

  const activeProviders = new Map() // roomName -> WebsocketProvider
  const docToRoom = new Map() // Y.Doc -> roomName
  const pendingRooms = new Set() // joins awaiting ticket fetch
  const leaveWhilePending = new Set() // rooms left while their join was in flight

  function getActiveWorkspaceId() {
    return workspaceStore.activeId
  }

  async function joinNoteRoom(noteId, doc, externalAwareness = null) {
    const workspaceId = getActiveWorkspaceId()
    if (!workspaceId) return

    const roomName = buildRoomName(workspaceId, noteId)
    if (activeProviders.has(roomName) || pendingRooms.has(roomName)) return
    pendingRooms.add(roomName)
    try {
      const wsUrl = getWebSocketUrl()
      const params = await getWsParams(workspaceId)
      if (leaveWhilePending.has(roomName)) {
        leaveWhilePending.delete(roomName)
        return
      }
      const awareness = externalAwareness || new awarenessProtocol.Awareness(doc)
      const provider = new WebsocketProvider(wsUrl, roomName, doc, {
        connect: true,
        params,
        awareness,
      })

      // On connection/reconnection: re-attach notification listener and
      // trigger a pull to catch up on anything missed while disconnected.
      provider.on('status', ({ status }) => {
        if (status === 'connected') {
          attachNotificationListener(provider)
          forceSyncNow().catch(() => {})
        }
      })
      // Attach immediately if already connecting
      attachNotificationListener(provider)

      activeProviders.set(roomName, provider)
      docToRoom.set(doc, roomName)
    } finally {
      pendingRooms.delete(roomName)
    }
  }

  function leaveNoteRoom(noteId) {
    const workspaceId = getActiveWorkspaceId() || ''
    const roomName = buildRoomName(workspaceId, noteId)
    const provider = activeProviders.get(roomName)
    if (provider) {
      detachNotificationListener(provider)
      provider.destroy()
      activeProviders.delete(roomName)
    } else if (pendingRooms.has(roomName)) {
      leaveWhilePending.add(roomName)
    }
    for (const [doc, name] of docToRoom) {
      if (name === roomName) {
        docToRoom.delete(doc)
        break
      }
    }
    unregisterActiveDoc(noteId)
  }

  async function joinMetaRoom(workspaceId) {
    const roomName = buildMetaRoomName(workspaceId)
    if (activeProviders.has(roomName) || pendingRooms.has(roomName)) return
    pendingRooms.add(roomName)
    try {
      const doc = getWorkspaceDoc()
      const wsUrl = getWebSocketUrl()
      const params = await getWsParams(workspaceId)
      if (leaveWhilePending.has(roomName)) {
        leaveWhilePending.delete(roomName)
        return
      }
      const provider = new WebsocketProvider(wsUrl, roomName, doc, {
        connect: true,
        params,
        awareness: new awarenessProtocol.Awareness(doc),
      })

      // On connection/reconnection: re-attach notification listener and
      // trigger a pull to catch up on anything missed while disconnected.
      provider.on('status', ({ status }) => {
        if (status === 'connected') {
          attachNotificationListener(provider)
          forceSyncNow().catch(() => {})
        }
      })
      attachNotificationListener(provider)

      activeProviders.set(roomName, provider)
      docToRoom.set(doc, roomName)

      ensureMetaRoomKey(workspaceId).catch((err) => {
        console.warn('[ws-sync] meta room key not set:', err?.message || err)
      })
    } finally {
      pendingRooms.delete(roomName)
    }
  }

  function connect() {
    for (const [, provider] of activeProviders) {
      provider.connect()
    }
  }

  function disconnect() {
    for (const [, provider] of activeProviders) {
      detachNotificationListener(provider)
      provider.disconnect()
    }
    for (const room of pendingRooms) leaveWhilePending.add(room)
    activeProviders.clear()
    docToRoom.clear()
    collabKeys.clear()
    clearUnwrappedKeyCache()
  }

  function start() {
    if (!isAuthenticated()) return
    connect()
  }

  function handleWorkspaceSwitch(workspaceId) {
    for (const [roomName, provider] of activeProviders) {
      if (roomName.startsWith('workspace:')) {
        detachNotificationListener(provider)
        provider.destroy()
        activeProviders.delete(roomName)
      }
    }
    for (const room of pendingRooms) leaveWhilePending.add(room)
    for (const [doc, roomName] of docToRoom) {
      if (roomName.startsWith('workspace:')) {
        docToRoom.delete(doc)
      }
    }

    if (isAuthenticated()) {
      joinMetaRoom(workspaceId)
    }
  }

  function handleNoteSwitch(noteId, doc) {
    for (const [roomName] of activeProviders) {
      if (roomName.endsWith(`:note:${noteId}`)) return
    }
    joinNoteRoom(noteId, doc)
  }

  // TODO: role-based access control needs the server to send role info in the auth message
  function getRoomRole(_noteId) {
    return 'editor'
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
      for (const [, provider] of activeProviders) {
        if (provider.wsconnected) return true
      }
      return false
    },
  }
}

let wsSyncInstance = null

export function getWsSync() {
  if (!wsSyncInstance) {
    wsSyncInstance = useWsSync()
  }
  return wsSyncInstance
}
