import { WebsocketProvider } from 'y-websocket'
import * as awarenessProtocol from 'y-protocols/awareness'
import { useAccountStore } from '@/store/account'
import { useWorkspaceStore } from '@/store/workspace'
import { getWorkspaceDoc } from '@/lib/yjs/meta-doc'
import { registerActiveDoc, unregisterActiveDoc } from '@/lib/yjs/shared'
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
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}`
}

function getAuthToken() {
  return useAccountStore().token || ''
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

  function getActiveWorkspaceId() {
    return workspaceStore.activeId
  }

  function joinNoteRoom(noteId, doc) {
    const workspaceId = getActiveWorkspaceId()
    if (!workspaceId) return

    const roomName = buildRoomName(workspaceId, noteId)
    if (activeProviders.has(roomName)) return

    const wsUrl = getWebSocketUrl()
    const token = getAuthToken()
    const provider = new WebsocketProvider(wsUrl, roomName, doc, {
      connect: true,
      params: token ? { token } : {},
      awareness: new awarenessProtocol.Awareness(doc),
    })

    // Re-attach notification listener on each reconnection (provider.ws is reassigned)
    provider.on('status', ({ status }) => {
      if (status === 'connected') {
        attachNotificationListener(provider)
      }
    })
    // Attach immediately if already connecting
    attachNotificationListener(provider)

    activeProviders.set(roomName, provider)
    docToRoom.set(doc, roomName)
    registerActiveDoc(noteId, doc)
  }

  function leaveNoteRoom(noteId) {
    const workspaceId = getActiveWorkspaceId() || ''
    const roomName = buildRoomName(workspaceId, noteId)
    const provider = activeProviders.get(roomName)
    if (provider) {
      detachNotificationListener(provider)
      provider.destroy()
      activeProviders.delete(roomName)
    }
    for (const [doc, name] of docToRoom) {
      if (name === roomName) {
        docToRoom.delete(doc)
        break
      }
    }
    unregisterActiveDoc(noteId)
  }

  function joinMetaRoom(workspaceId) {
    const roomName = buildMetaRoomName(workspaceId)
    if (activeProviders.has(roomName)) return

    const doc = getWorkspaceDoc()
    const wsUrl = getWebSocketUrl()
    const token = getAuthToken()
    const provider = new WebsocketProvider(wsUrl, roomName, doc, {
      connect: true,
      params: token ? { token } : {},
      awareness: new awarenessProtocol.Awareness(doc),
    })

    // Re-attach notification listener on each reconnection
    provider.on('status', ({ status }) => {
      if (status === 'connected') {
        attachNotificationListener(provider)
      }
    })
    attachNotificationListener(provider)

    activeProviders.set(roomName, provider)
    docToRoom.set(doc, roomName)

    ensureMetaRoomKey(workspaceId).catch((err) => {
      console.warn('[ws-sync] meta room key not set:', err?.message || err)
    })
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
