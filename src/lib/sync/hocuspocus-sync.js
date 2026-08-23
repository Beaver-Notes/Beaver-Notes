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
import { encryptMapValue, decryptMapValue } from '@/utils/crypto/content-encrypt'

// Collaboration keys per room (roomName -> CryptoKey)
const collabKeys = new Map()

// Content encryption keys per room (roomName -> CryptoKey)
const contentKeys = new Map()

const ENCRYPTED_MAP_KEYS = ['title', 'content']

// observer refs per room (roomName -> observer fn)
const contentObservers = new Map()

function setupContentEncryption(doc, roomName) {
  const key = contentKeys.get(roomName)
  if (!key) return

  const map = doc.getMap('note')
  const observer = async (event) => {
    if (event.transaction?.origin === 'hocuspocus') return
    for (const [changedKey] of event.changes.keys) {
      const val = map.get(changedKey)
      if (ENCRYPTED_MAP_KEYS.includes(changedKey) && typeof val === 'string') {
        try {
          const encrypted = await encryptMapValue(key, changedKey, val)
          map.set(changedKey, encrypted, 'hocuspocus')
        } catch (err) {
          console.warn(`[hocuspocus] failed to encrypt ${changedKey}:`, err.message)
        }
      }
    }
  }
  contentObservers.set(roomName, observer)
  map.observe(observer)
}

async function decryptMapValues(doc, roomName) {
  const key = contentKeys.get(roomName)
  if (!key) return

  const map = doc.getMap('note')
  for (const mapKey of ENCRYPTED_MAP_KEYS) {
    const val = map.get(mapKey)
    if (val instanceof Uint8Array) {
      try {
        const decrypted = await decryptMapValue(key, mapKey, val)
        map.set(mapKey, decrypted, 'hocuspocus')
      } catch (err) {
        console.warn(`[hocuspocus] failed to decrypt ${mapKey}:`, err.message)
      }
    }
  }
}

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
    contentKeys.set(roomName, key)
  } catch (err) {
    console.error('[hocuspocus] failed to import collab key:', err)
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

export function useHocuspocusSync() {
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

    setupContentEncryption(doc, roomName)

    const wsUrl = getWebSocketUrl()
    const token = getAuthToken()
    const provider = new WebsocketProvider(wsUrl, roomName, doc, {
      connect: true,
      params: token ? { token } : {},
      awareness: new awarenessProtocol.Awareness(doc),
    })

    provider.on('sync', async (isSynced) => {
      if (isSynced) {
        await decryptMapValues(doc, roomName)
      }
    })

    activeProviders.set(roomName, provider)
    docToRoom.set(doc, roomName)
    registerActiveDoc(noteId, doc)
  }

  function leaveNoteRoom(noteId) {
    const workspaceId = getActiveWorkspaceId() || ''
    const roomName = buildRoomName(workspaceId, noteId)
    const provider = activeProviders.get(roomName)
    if (provider) {
      provider.destroy()
      activeProviders.delete(roomName)
    }
    const observer = contentObservers.get(roomName)
    if (observer) {
      for (const [doc, name] of docToRoom) {
        if (name === roomName) {
          doc.getMap('note').unobserve(observer)
          break
        }
      }
      contentObservers.delete(roomName)
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

    activeProviders.set(roomName, provider)
    docToRoom.set(doc, roomName)

    ensureMetaRoomKey(workspaceId).catch((err) => {
      console.warn('[hocuspocus] meta room key not set:', err?.message || err)
    })
  }

  function connect() {
    for (const [, provider] of activeProviders) {
      provider.connect()
    }
  }

  function disconnect() {
    for (const [, provider] of activeProviders) {
      provider.disconnect()
    }
    for (const [roomName, observer] of contentObservers) {
      for (const [doc, name] of docToRoom) {
        if (name === roomName) {
          doc.getMap('note').unobserve(observer)
          break
        }
      }
    }
    contentObservers.clear()
    activeProviders.clear()
    docToRoom.clear()
    collabKeys.clear()
    contentKeys.clear()
    clearUnwrappedKeyCache()
  }

  function start() {
    if (!isAuthenticated()) return
    connect()
  }

  function handleWorkspaceSwitch(workspaceId) {
    for (const [roomName, provider] of activeProviders) {
      if (roomName.startsWith('workspace:')) {
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

let hocuspocusInstance = null

export function getHocuspocusSync() {
  if (!hocuspocusInstance) {
    hocuspocusInstance = useHocuspocusSync()
  }
  return hocuspocusInstance
}
