import { WebsocketProvider } from 'y-websocket'
import * as awarenessProtocol from 'y-protocols/awareness'
import { useAccountStore } from '@/store/account'
import { useWorkspaceStore } from '@/store/workspace'
import { useCollaboratorStore } from '@/store/collaborator'
import { getWorkspaceDoc } from '@/lib/yjs/meta-doc'
import { unregisterActiveDoc } from '@/lib/yjs/shared'
import {
  importCollabKey,
  isValidCollabKey,
} from '@/utils/crypto/collab'
import { clearUnwrappedKeyCache } from '@/utils/crypto/note-key'
import { loadOrCreateIdentity } from '@/utils/crypto/identity'
import { getCachedWorkspaceKey, recoverWorkspaceKeyHex } from '@/lib/api/workspaces'
import { kickRustSync } from '@/utils/sync/rust-shim.js'
import { registerSharedSyncKey, clearSharedSyncKeys } from '@/utils/sync/shared-keys.js'
import { ROLES, canEdit } from '@/utils/permissions'
import { createEncryptedWebSocket } from './encrypted-websocket.js'

// Collaboration keys per room (roomName -> CryptoKey)
const collabKeys = new Map()

// Room joins skipped because the key wasn't ready yet (roomName -> rejoin fn).
// `setRoomKey` re-runs them once the key lands, so a room whose key is
// provisioned after the first attempt self-heals instead of staying off.
const pendingKeyJoins = new Map()

// Text notification listeners per provider, tracked for cleanup.
const notificationListeners = new WeakMap()

/** Notify-only sync trigger: the Rust scheduler owns pull/push (debounced
 * `sync_kick`). */
function notifySyncNow() {
  kickRustSync()
}

/** y-websocket handles only binary (types 0-3). Relay sends JSON text notifications: intercept and pull. Re-attaches on reconnect. */
function createNotificationHandler() {
  return (event) => {
    if (typeof event.data !== 'string') return
    try {
      const msg = JSON.parse(event.data)
      if (msg.type === 'notification') {
        console.warn('[ws-sync] notification from server, triggering sync')
        notifySyncNow()
      }
    } catch {
      // Not JSON: ignore.
    }
  }
}

function attachNotificationListener(provider) {
  detachNotificationListener(provider)
  ignoreTextFrames(provider)
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

/** y-websocket decodes every socket message as binary, but the relay
 * multiplexes JSON text frames (auth on connect, notifications per sync)
 * on the same socket. A text frame becomes a zero-length buffer and throws
 * "Unexpected end of array" as a global error on every connect and every
 * notification. Skip non-binary frames here; the notification listener
 * above handles the text side. Re-applied per socket since y-websocket
 * reassigns onmessage on every reconnect. */
export function ignoreTextFrames(provider) {
  const ws = provider?.ws
  if (!ws || ws._beaverTextGuard) return
  ws._beaverTextGuard = true
  const orig = ws.onmessage
  ws.onmessage = (event) => {
    if (!(event?.data instanceof ArrayBuffer)) return
    return orig?.call(ws, event)
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
    console.warn('[ws-sync] invalid collab key for room', roomName)
    return
  }
  try {
    const key = await importCollabKey(hexKey)
    collabKeys.set(roomName, key)
    const retry = pendingKeyJoins.get(roomName)
    if (retry) {
      pendingKeyJoins.delete(roomName)
      Promise.resolve()
        .then(() => retry())
        .catch((err) =>
          console.warn('[ws-sync] deferred room join failed:', err?.message || err),
        )
    }
  } catch (err) {
    console.error('[ws-sync] failed to import collab key:', err)
  }
}

/** Skip a room whose key isn't provisioned: no socket, no plaintext fallback.
 * The durable Rust path still runs (the local changes still get pushed) and a
 * later `setRoomKey` re-runs `rejoin`. */
function skipUnkeyedRoom(roomName, rejoin, kind) {
  pendingKeyJoins.set(roomName, rejoin)
  console.warn(
    `[ws-sync] no key for ${kind} ${roomName}; realtime skipped, durable sync continues`,
  )
  notifySyncNow()
}

export function getWebSocketUrl() {
  // The user's server URL (Settings → Server) is authoritative: a custom
  // server is useless if realtime still points at a hardcoded host.
  const server = getServerBase().replace(/\/+$/, '');
  const stockApi = (
    import.meta.env.VITE_BEAVER_SYNC_API_URL || 'http://localhost:4000'
  ).replace(/\/+$/, '');
  const envWs = (
    import.meta.env.VITE_BEAVER_SYNC_WS_URL ||
    import.meta.env.VITE_HOCUSPOCUS_URL ||
    ''
  ).replace(/\/+$/, '');
  // Stock dev default keeps the explicit override (API :4000, relay :8080).
  if (envWs && server === stockApi) return envWs;
  // Otherwise the relay lives on the server's own origin (prod Caddy routes
  // WS on the same host). Dev/test stacks split ports: API :3000/:4000 pairs
  // with the relay on :8080.
  try {
    const u = new URL(server);
    const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:';
    const host =
      u.port === '3000' || u.port === '4000'
        ? `${u.hostname}:8080`
        : u.host;
    return `${wsProto}//${host}`;
  } catch {
    return envWs || 'ws://localhost:8080';
  }
}

function getAuthToken() {
  return useAccountStore().token || ''
}

// One server base for WS URL derivation and the ws-ticket fetch, so custom-server
// users talk to the same host over REST and WS. Store setting first, env fallback.
function getServerBase() {
  let serverUrl
  try {
    serverUrl = useAccountStore()?.serverUrl
  } catch {
    serverUrl = undefined
  }
  return (
    ((typeof serverUrl === 'string' && serverUrl.trim()) ||
      import.meta.env.VITE_BEAVER_SYNC_API_URL ||
      'http://localhost:4000')
  ).replace(/\/+$/, '')
}

// One-time short-lived ticket so the session token never appears in the WS URL.
// Fail-closed: no ticket means joining without auth params, the server rejects it.
async function getWsParams(workspaceId) {
  const token = getAuthToken()
  if (!token) return {}
  try {
    const res = await fetch(`${getServerBase()}/auth/ws-ticket`, {
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
    // fall through to unauthenticated join below
  }
  console.warn('[ws-sync] ws-ticket unavailable, joining without auth params')
  return {}
}

function isAuthenticated() {
  const accountStore = useAccountStore()
  return accountStore.status === 'authenticated' && !!accountStore.token
}

export async function ensureMetaRoomKey(workspaceId) {
  if (!workspaceId) return
  // Cache-first, then the Phase 1 recovery helper: device KEM envelopes first,
  // then the legacy items-key envelope, so a legacy-only workspace's meta room
  // is recovered too. Never prompts; recovery only reads and caches.
  let workspaceKeyHex = getCachedWorkspaceKey(workspaceId)
  if (!workspaceKeyHex) {
    const identity = await loadOrCreateIdentity()
    if (!identity?.privateKeyHex) {
      console.warn('[ws-sync] missing encryption identity for meta key')
      return
    }
    workspaceKeyHex = await recoverWorkspaceKeyHex(workspaceId, identity)
  }
  if (!workspaceKeyHex) {
    console.warn('[ws-sync] no recoverable workspace key for this device', workspaceId)
    return
  }
  await setRoomKey(buildMetaRoomName(workspaceId), workspaceKeyHex)
  // The durable `meta` doc seals under the workspace key so every member can
  // read folders/labels; without this it stays under the account items key.
  await registerSharedSyncKey('meta', workspaceKeyHex)
}

export function useWsSync() {
  const workspaceStore = useWorkspaceStore()

  const activeProviders = new Map() // roomName -> WebsocketProvider
  const docToRoom = new Map() // Y.Doc -> roomName
  const pendingRooms = new Set() // joins awaiting ticket fetch
  const leaveWhilePending = new Set() // rooms left while their join was in flight
  const reconnectTimers = new Map() // roomName -> timeout id
  const reconnectAttempts = new Map() // roomName -> count

  // Server ws-tickets are single-use: any failed connection poisons that
  // provider's ticket, and y-websocket would retry with it forever (401s).
  // Rejoin with a fresh ticket instead, backing off to 15s.
  function clearRejoin(roomName) {
    clearTimeout(reconnectTimers.get(roomName))
    reconnectTimers.delete(roomName)
    reconnectAttempts.delete(roomName)
  }

  function scheduleRejoin(roomName, rejoin) {
    if (!activeProviders.has(roomName)) return // left meanwhile
    const attempts = (reconnectAttempts.get(roomName) || 0) + 1
    reconnectAttempts.set(roomName, attempts)
    clearTimeout(reconnectTimers.get(roomName))
    reconnectTimers.set(
      roomName,
      setTimeout(async () => {
        const cur = activeProviders.get(roomName)
        if (cur) {
          detachNotificationListener(cur)
          cur.destroy()
          activeProviders.delete(roomName)
        }
        try {
          await rejoin()
        } catch {
          // rejoin failure schedules its own retry via the status handler
        }
      }, Math.min(1000 * attempts, 15000)),
    )
  }

  function getActiveWorkspaceId() {
    return workspaceStore.activeId
  }

  async function joinNoteRoom(noteId, doc, externalAwareness = null) {
    const workspaceId = getActiveWorkspaceId()
    if (!workspaceId) return

    const roomName = buildRoomName(workspaceId, noteId)
    if (pendingRooms.has(roomName)) return
    const existing = activeProviders.get(roomName)
    if (existing) {
      // Reuse only when the provider already broadcasts the caller's awareness;
      // otherwise the UI reads one awareness while the server relays another
      // (orphaned local presence shows up as phantom peers).
      if (!externalAwareness || existing.awareness === externalAwareness) return
      detachNotificationListener(existing)
      existing.destroy()
      activeProviders.delete(roomName)
    }
    // Realtime is an accelerator, never a prerequisite: without the room key
    // there is nothing safe to send, so don't open a socket at all. The durable
    // Rust path carries the changes; setRoomKey retries this join on arrival.
    if (!collabKeys.has(roomName)) {
      skipUnkeyedRoom(roomName, () => joinNoteRoom(noteId, doc, externalAwareness), 'note room')
      return
    }
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
        // y-websocket's same-origin BroadcastChannel path publishes awareness in
        // the clear (it is separate from the encrypted WebSocket polyfill, which
        // only wraps the socket transport). Beaver Notes has no cross-tab need,
        // so disable that path entirely rather than patch y-websocket internals.
        disableBc: true,
        WebSocketPolyfill: createEncryptedWebSocket(roomName, () =>
          collabKeys.get(roomName),
        ),
      })

      // Mark the room's first-sync state on the shared awareness so the
      // live-collab extension can ignore the opening catch-up (it would
      // otherwise flash a highlight over the note's pre-existing content).
      // `undefined` (no provider) is treated as ready by the extension.
      awareness.liveCollabRoomReady = false
      provider.on('sync', (synced) => {
        if (synced) awareness.liveCollabRoomReady = true
      })

      // On connection/reconnection: re-attach notification listener and
      // trigger a pull to catch up on anything missed while disconnected.
      provider.on('status', ({ status }) => {
        if (status === 'connected') {
          reconnectAttempts.delete(roomName)
          attachNotificationListener(provider)
          notifySyncNow()
        } else if (status === 'disconnected') {
          scheduleRejoin(roomName, () => joinNoteRoom(noteId, doc, awareness))
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
    clearRejoin(roomName)
    pendingKeyJoins.delete(roomName)
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
      // Provision the room key before connecting: the encrypted provider drops
      // sync frames until a key exists, so connect-after-key avoids a stall.
      await ensureMetaRoomKey(workspaceId).catch((err) => {
        console.warn('[ws-sync] meta room key not set:', err?.message || err)
      })
      // Same fail-closed gate as note rooms: no key, no socket.
      if (!collabKeys.has(roomName)) {
        skipUnkeyedRoom(roomName, () => joinMetaRoom(workspaceId), 'meta room')
        return
      }
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
        // Same reason as the note room: no plaintext same-origin presence.
        disableBc: true,
        WebSocketPolyfill: createEncryptedWebSocket(roomName, () =>
          collabKeys.get(roomName),
        ),
      })

      // On connection/reconnection: re-attach notification listener and
      // trigger a pull to catch up on anything missed while disconnected.
      provider.on('status', ({ status }) => {
        if (status === 'connected') {
          reconnectAttempts.delete(roomName)
          attachNotificationListener(provider)
          notifySyncNow()
        } else if (status === 'disconnected') {
          scheduleRejoin(roomName, () => joinMetaRoom(workspaceId))
        }
      })
      attachNotificationListener(provider)

      activeProviders.set(roomName, provider)
      docToRoom.set(doc, roomName)
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
    for (const room of reconnectTimers.keys()) clearRejoin(room)
    for (const room of pendingRooms) leaveWhilePending.add(room)
    activeProviders.clear()
    docToRoom.clear()
    collabKeys.clear()
    pendingKeyJoins.clear()
    clearUnwrappedKeyCache()
    void clearSharedSyncKeys()
  }

  function start() {
    if (!isAuthenticated()) return
    const workspaceId = getActiveWorkspaceId()
    connect()
    // After a sign-out `stop()` all providers were dropped. Re-arm the meta room
    // so realtime + presence recover on sign-in within the same session.
    if (workspaceId) {
      const metaRoom = buildMetaRoomName(workspaceId)
      if (!activeProviders.has(metaRoom) && !pendingRooms.has(metaRoom)) {
        joinMetaRoom(workspaceId)
      }
    }
  }

  function handleWorkspaceSwitch(workspaceId) {
    for (const [roomName, provider] of activeProviders) {
      if (roomName.startsWith('workspace:')) {
        detachNotificationListener(provider)
        provider.destroy()
        activeProviders.delete(roomName)
        clearRejoin(roomName)
      }
    }
    for (const room of pendingRooms) leaveWhilePending.add(room)
    for (const room of pendingKeyJoins.keys()) pendingKeyJoins.delete(room)
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

  // Fail-closed role resolution: a note with known sharing context that does
  // not list us resolves VIEWER. Notes with no sharing context resolve
  // EDITOR (local owner). The server remains authoritative; this only gates
  // local editing UI and Yjs sends.
  function getRoomRole(noteId) {
    const accountStore = useAccountStore()
    const userId = accountStore.profile?.id
    const collaboratorStore = useCollaboratorStore()

    // 1. Per-note collaborator role (most specific), but only when the store
    // actually describes this note. Stale state from a previously opened
    // note must not leak into this one.
    if (collaboratorStore.noteId === noteId) {
      const self = collaboratorStore.collaborators.find(
        (c) =>
          (userId && c.userId === userId) ||
          (accountStore.profile?.username && c.username === accountStore.profile.username),
      )
      if (self?.role) return self.role
      return ROLES.VIEWER
    }

    // 2. Fall back to workspace role
    const workspaceStore = useWorkspaceStore()
    const wsRole = workspaceStore.activeWorkspace?.role
    if (wsRole) return wsRole === 'admin' || canEdit(wsRole) ? ROLES.EDITOR : ROLES.VIEWER

    // 3. No sharing context for this note: owner
    return ROLES.EDITOR
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
