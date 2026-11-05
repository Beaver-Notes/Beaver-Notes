import { WebsocketProvider } from 'y-websocket'
import * as awarenessProtocol from 'y-protocols/awareness'
import { shallowRef } from 'vue'
import { useAccountStore } from '@/store/account'
import { useWorkspaceStore } from '@/store/workspace'
import { useCollaboratorStore } from '@/store/collaborator'
import { getWorkspaceDoc } from '@/lib/yjs/meta-doc'
import { unregisterActiveDoc } from '@/lib/yjs/shared'
import {
  importCollabKey,
  isValidCollabKey,
} from '@/utils/crypto/collab'
import { logger } from '@/utils/logger'
import { clearUnwrappedKeyCache } from '@/utils/crypto/note-key'
import { loadOrCreateIdentity } from '@/utils/crypto/identity'
import {
  getCachedWorkspaceKey,
  recoverWorkspaceKeyHex,
  clearWorkspaceKeyCache,
} from '@/lib/api/workspaces'
import { kickRustSync } from '@/utils/sync/rust-shim.js'
import { registerSharedSyncKey, clearSharedSyncKeys, registerWsKeyForNotes, setActiveWsKey } from '@/utils/sync/shared-keys.js'
import { resolveNoteWorkspaceId } from '@/utils/sync/shared-notes.js'
import { ROLES, canEdit } from '@/utils/permissions'
import { createEncryptedWebSocket } from './encrypted-websocket.js'

// Collaboration keys per room (roomName -> CryptoKey)
const collabKeys = new Map()

// Workspace meta-room awareness (one workspace at a time), for workspace-scope
// presence. Set when the meta room joins, cleared on disconnect/workspace switch.
// A ref so consumers can watch it: ws-sync.js is session-long, and the awareness
// lands after `useWorkspacePresence` mounts (or is swapped on workspace switch).
const metaRoomAwareness = shallowRef(null)

// y-websocket sends awareness over the websocket ONLY from its
// `awareness.on('update')` handler; its one-shot initial broadcast lives in the
// BroadcastChannel path, which we disable. The page sets the local state before
// the provider exists, so nothing fires that handler and peers never learn about
// us: no avatars. Re-set the same state to force the broadcast (null first,
// because y-protocols emits nothing when the new state deep-equals the old one).
function rebroadcastLocalAwareness(awareness, roomName, label) {
  const local = awareness?.getLocalState?.()
  if (!local) return
  awareness.setLocalState(null)
  try {
    awareness.setLocalState(local)
  } catch (err) {
    // A throw here would escape the status handler and take the join down with
    // it; the socket itself is fine, so only report it.
    console.warn(
      `[ws-sync] awareness rebroadcast failed for room ${roomName} (${label}): ${err?.message || err}`,
    )
  }
}

// Room joins skipped because the key wasn't ready yet (roomName -> rejoin fn).
// `setRoomKey` re-runs them once the key lands, so a room whose key is
// provisioned after the first attempt self-heals instead of staying off.
const pendingKeyJoins = new Map()

// Fire-and-log sink for every floating room join: join functions are async
// with try/finally and no catch, so a rejection must be logged at the call
// site instead of floating as an unhandled rejection with no trace.
export function fireAndLog(promise, label) {
  Promise.resolve(promise).catch((err) =>
    console.warn(`[ws-sync] ${label} failed: ${err?.message || err}`),
  )
}

// Key for a note join parked because no workspace id resolved yet: the room name
// needs that id, so the pending entry can't live under it until the id lands.
function parkedNoteJoinKey(noteId) {
  return `parked:note:${noteId}`
}

// Text notification listeners per provider, tracked for cleanup.
const notificationListeners = new WeakMap()

// Note rooms that were joined this session (roomName -> { noteId, doc,
// awareness }). `disconnect()` tears every provider down and nothing else can
// re-join them, so `start()` replays these to keep note rooms alive across a
// stop/start cycle.
const noteRoomArgs = new Map()

// The room a note joined under, recorded at join time. Leaving resolves from
// here first: after a revoked share the note's `access` is gone, so resolving
// the room at leave time would build the active workspace's room, never find
// the owner-workspace provider, and leave a ghost socket in a 403 rejoin loop.
const roomByNote = new Map()

/** Notify-only sync trigger: the Rust scheduler owns pull/push (debounced
 * `sync_kick`). */
function notifySyncNow() {
  kickRustSync()
}

/** Wording for the human events the server relays (ids only, no text). */
const USER_NOTIFICATION_TITLES = {
  mention: 'You were mentioned in a comment',
  comment: 'New comment',
  note_shared: 'A note was shared with you',
}

/** OS notification for a human event. Best-effort: no store yet or no
 * permission must not break the relay handler. */
async function showUserNotification(msg) {
  const title = USER_NOTIFICATION_TITLES[msg.kind]
  if (!title) return
  // Already looking at that note: the editor shows it live.
  if (msg.noteId && document.hasFocus() && location.hash.includes(msg.noteId)) return
  let body = 'Beaver Notes'
  try {
    const { useNoteStore } = await import('@/store/note')
    body = useNoteStore().data?.[msg.noteId]?.title || body
  } catch {
    // Store not ready: the generic body is enough.
  }
  try {
    const { notify } = await import('@/lib/native/app')
    // iOS stores `extra` as string pairs: a null value drops the whole payload,
    // and a tap without it cannot open the note it announced.
    const extra = {}
    if (msg.noteId) extra.noteId = msg.noteId
    if (msg.workspaceId) extra.workspaceId = msg.workspaceId
    const shown = await notify({
      title,
      body,
      extra: Object.keys(extra).length ? extra : null,
    })
    logger.debug(`[ws-sync] user-notification ${msg.kind} -> ${shown ? 'shown' : 'suppressed'}`)
  } catch {
    // Notifications are best-effort.
  }
}

/** y-websocket handles only binary (types 0-3). Relay sends JSON text notifications: intercept and pull. Re-attaches on reconnect. */
function createNotificationHandler() {
  return (event) => {
    if (typeof event.data !== 'string') return
    try {
      const msg = JSON.parse(event.data)
      if (msg.type === 'user-notification') {
        void showUserNotification(msg)
        return
      }
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

// Inverse of the room-name builders, so a ticket is fetched with the same
// (workspaceId, noteId) pair the room was created from.
function parseRoomName(roomName) {
  const note = /^workspace:(.+):note:(.+)$/.exec(roomName)
  if (note) return { workspaceId: note[1], noteId: note[2] }
  const meta = /^workspace:(.+):meta$/.exec(roomName)
  if (meta) return { workspaceId: meta[1], noteId: null }
  return null
}

/** Mint a fresh single-use ticket for an existing provider and assign it.
 * y-websocket keeps `opts.params` and re-reads it on every socket, so a
 * reconnect after this needs no new provider (and no new listeners). */
async function refreshProviderParams(roomName, provider) {
  if (!provider) return false
  const parsed = parseRoomName(roomName)
  if (!parsed) return false
  const params = await getWsParams(parsed.workspaceId, parsed.noteId)
  if (!params.ticket) {
    console.warn(`[ws-sync] no fresh ws-ticket for ${roomName}; socket left closed`)
    return false
  }
  provider.params = params
  return true
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
    // A join parked for a missing workspace id waits under a note-scoped
    // sentinel; a key for that note can only arrive once the workspace resolved,
    // so this is the signal that the deferred join can be re-run.
    const noteId = roomName.split(':note:')[1]
    const parked = noteId && pendingKeyJoins.get(parkedNoteJoinKey(noteId))
    if (parked) {
      pendingKeyJoins.delete(parkedNoteJoinKey(noteId))
      Promise.resolve()
        .then(() => parked())
        .catch((err) =>
          console.warn('[ws-sync] deferred note room join failed:', err?.message || err),
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

/** Re-run note joins that were parked for a missing workspace id. The id lands
 * asynchronously (`access` is stamped on the note by the shared-notes
 * reconciliation), which never reaches `setRoomKey`, so without this the parked
 * closure is never revived and the room stays unjoined for the whole session:
 * no realtime, no presence. */
export function retryParkedNoteJoins() {
  const parked = Array.from(pendingKeyJoins.entries()).filter(([key]) => key.startsWith('parked:note:'))
  for (const [key, retry] of parked) {
    pendingKeyJoins.delete(key)
    Promise.resolve()
      .then(() => retry())
      .catch((err) =>
        console.warn('[ws-sync] revived note room join failed:', err?.message || err),
      )
  }
}

// The owning workspace id arrives from the shared-notes reconciliation, which
// knows nothing about parked joins; without this wake-up the note room stays
// unjoined for the rest of the session (no realtime, no presence).
if (typeof window !== 'undefined') {
  window.addEventListener('beaver:shared-note-access', retryParkedNoteJoins)
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

// SC-1-07: a ws:// relay for a non-loopback http:// server sends the ws
// ticket, notifications and room metadata in the clear, and hands a same-LAN
// attacker the SC-1-01 injection path without touching the relay host.
// Realtime is refused there (durable sync is unaffected); loopback stays
// allowed because the stock dev stacks are http://localhost by design.
// Exported for tests (same reason as ignoreTextFrames).
export function plaintextRelayAllowed(wsUrl) {
  try {
    const u = new URL(wsUrl)
    if (u.protocol !== 'ws:') return true
    return isLoopbackHost(u.hostname)
  } catch {
    // Unparsable input is never a verified loopback: refuse (fail closed).
    // Production URLs from getWebSocketUrl() always parse, so this only ever
    // refuses a malformed override, and durable sync is unaffected anyway.
    return false
  }
}

// Exact loopback match. `host.startsWith('127.')` would also match names like
// `127.0.0.1.evil.com` (ISSUE-2), so a host passes only when it IS localhost,
// an IPv6 loopback literal, or a full 4-octet IPv4 quad with first octet 127
// (each octet 0-255, decimal, no signs/hex/whitespace). The URL parser
// canonicalizes short IPv4 forms before this runs (ws://127.1 → 127.0.0.1);
// anything non-numeric here is a DNS name, never a loopback address.
function isLoopbackHost(host) {
  if (host === 'localhost' || host === '::1' || host === '[::1]') return true
  const parts = host.split('.')
  if (parts.length !== 4) return false
  const octets = parts.map((p) => (p !== '' && String(Number(p)) === p ? Number(p) : -1))
  return octets[0] === 127 && octets.every((n) => n >= 0 && n <= 255)
}

function refusePlaintextRelay(wsUrl) {
  console.warn(
    `[ws-sync] refusing plaintext relay ${wsUrl}: the server URL is http:// on a non-loopback host. ` +
      'Set an https:// server URL in Settings → Account to enable realtime collaboration.',
  )
  try {
    useAccountStore().setError(
      'Realtime collaboration is disabled: your server URL uses http://. Switch it to https:// in Settings → Account to enable realtime.',
    )
  } catch {
    // No store in this context: the console warning stands.
  }
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
const WS_TICKET_TIMEOUT_MS = 15000
async function getWsParams(workspaceId, noteId) {
  const token = getAuthToken()
  if (!token) return {}
  try {
    const res = await fetch(`${getServerBase()}/auth/ws-ticket`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      // Bounded: an unanswered request would otherwise hold this room in
      // `pendingRooms` for the rest of the session, so it could never rejoin.
      signal: AbortSignal.timeout(WS_TICKET_TIMEOUT_MS),
      // noteId authorizes an invited non-member for the note room only.
      body: JSON.stringify(
        workspaceId ? { workspaceId, ...(noteId ? { noteId } : {}) } : {},
      ),
    })
    if (res.ok) {
      const { ticket } = await res.json()
      if (ticket) return { ticket }
    }
    // Say why: without the status there is no way to tell an authz 403 ("Not a
    // member of this workspace.") from a 400, a missing body field, or a proxy.
    const detail = await res.text().catch(() => '')
    warnNoTicket(workspaceId, noteId, `${res.status} ${detail.slice(0, 200)}`.trim() || 'no ticket in body')
    return {}
  } catch (err) {
    warnNoTicket(workspaceId, noteId, err?.message || String(err))
  }
  return {}
}

// Relay answers 401/403 without a ticket, so this is always fatal to the join.
function warnNoTicket(workspaceId, noteId, reason) {
  console.warn(
    `[ws-sync] ws-ticket unavailable for ${workspaceId || '?'}/${noteId || 'meta'}:`,
    reason,
    '— joining without auth params, the relay rejects the upgrade',
  )
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
      return null
    }
    workspaceKeyHex = await recoverWorkspaceKeyHex(workspaceId, identity)
  }
  if (!workspaceKeyHex) {
    console.warn('[ws-sync] no recoverable workspace key for this device', workspaceId)
    return null
  }
  // Keys first, room key last: the room key is a live-connection nicety, while
  // a missing shared key seals every later row under the account items key,
  // which no peer can ever open (F32).
  setActiveWsKey(workspaceKeyHex)
  // The durable `meta` doc seals under the workspace key so every member can
  // read folders/labels; without this it stays under the account items key.
  await registerSharedSyncKey('meta', workspaceKeyHex)
  // O7 Fix A: register the workspace key under every workspace note id so note
  // bodies seal under it too (all members readable), not the account items key.
  await registerWsKeyForNotes(getWorkspaceDoc().getMap('notes').keys(), workspaceKeyHex)
  try {
    await setRoomKey(buildMetaRoomName(workspaceId), workspaceKeyHex)
  } catch (err) {
    console.warn('[ws-sync] meta room key not applied:', err?.message || err)
  }
  return workspaceKeyHex
}

export function useWsSync() {
  const workspaceStore = useWorkspaceStore()

  const activeProviders = new Map() // roomName -> WebsocketProvider
  const docToRoom = new Map() // Y.Doc -> roomName
  // roomName -> in-flight join promise. A second join for a room waits on it
  // instead of being dropped, so the room always ends up with a live provider.
  const pendingRooms = new Map()
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
    if (!activeProviders.has(roomName)) {
      // Never exit a rejoin with no trace: a room that silently has no provider
      // looks exactly like a dropped join from the outside.
      console.warn(`[ws-sync] rejoin skipped for ${roomName}; no provider registered (left meanwhile)`)
      return
    }
    const attempts = (reconnectAttempts.get(roomName) || 0) + 1
    reconnectAttempts.set(roomName, attempts)
    clearTimeout(reconnectTimers.get(roomName))
    reconnectTimers.set(
      roomName,
      setTimeout(async () => {
        try {
          const cur = activeProviders.get(roomName)
          if (cur) {
            detachNotificationListener(cur)
            // y-websocket retries on its own timer with the ticket already
            // redeemed server-side, so every reconnect also burned one 401. Stop
            // that internal retry; a fresh ticket below reopens the socket.
            cur.shouldConnect = false
            const refreshed = await refreshProviderParams(roomName, cur)
            if (refreshed) {
              cur.shouldConnect = true
              cur.connect()
              return
            }
            // No ticket to retry with: rebuild the room from scratch.
            cur.destroy()
            activeProviders.delete(roomName)
          }
          try {
            await rejoin()
          } catch {
            // rejoin failure schedules its own retry via the status handler
          }
        } catch (err) {
          // Anything outside the inner catch (token/params refresh, provider
          // rebuild) would escape the timer as an uncaught error.
          console.warn(
            `[ws-sync] rejoin timer for ${roomName} failed: ${err?.message || err}`,
          )
        }
      }, Math.min(1000 * attempts, 15000)),
    )
  }

  // A rejected upgrade never reaches 'connected', so no 'disconnected' status
  // follows and y-websocket keeps retrying internally with the already-redeemed
  // ticket. Cancel that internal retry and rebuild with a fresh ticket: the
  // installed provider only reads `opts.params` as a plain object, so it can't
  // be refreshed per attempt from inside it.
  function handleRejectedUpgrade(provider, roomName, rejoin) {
    provider.on('connection-close', (event) => {
      // `event` is null when we closed the socket ourselves (disconnect/destroy/
      // leave), and a socket that had connected emits 'disconnected' too; both
      // already have a path. Only a server-side close of a socket that never
      // connected needs this.
      if (event === null || provider.wsconnected) return
      provider.shouldConnect = false
      scheduleRejoin(roomName, rejoin)
    })
  }

  function getActiveWorkspaceId() {
    return workspaceStore.activeId
  }

  // A room can be registered for more than one doc (a replacement doc joined
  // before the old one was left), so a destroy clears every entry, not just the
  // first match.
  function forgetDocRoom(roomName) {
    for (const [doc, name] of docToRoom) {
      if (name === roomName) docToRoom.delete(doc)
    }
  }

  async function joinNoteRoom(noteId, doc, externalAwareness = null) {
    // A shared-with-me note joins its owning workspace's room (note-only
    // presence), not the caller's active workspace room.
    const workspaceId = resolveNoteWorkspaceId(noteId, getActiveWorkspaceId())
    if (!workspaceId) {
      // Returning silently here means the room is never joined and the note has
      // no presence or live typing, with nothing in the log to explain it. Park
      // the join instead: the room key can only arrive once the workspace id
      // does, and `setRoomKey` runs this closure from the parked key then.
      pendingKeyJoins.set(parkedNoteJoinKey(noteId), () =>
        joinNoteRoom(noteId, doc, externalAwareness),
      )
      console.warn(
        `[ws-sync] no workspace id for note room note:${noteId}; realtime skipped, durable sync continues`,
      )
      notifySyncNow()
      return
    }

    const roomName = buildRoomName(workspaceId, noteId)
    // A second concurrent join for the same room used to return here, dropping
    // its join with no log: the page emits `ydoc` more than once per note, so
    // the second emission silently lost the room. Wait for the in-flight join
    // instead; whichever caller wins the race ends up with the live provider.
    const inflight = pendingRooms.get(roomName)
    if (inflight) {
      try {
        await inflight
      } catch (err) {
        console.warn(
          `[ws-sync] concurrent join for room ${roomName} (note ${noteId}) followed a failed join: ${err?.message || err}`,
        )
      }
      return
    }
    const existing = activeProviders.get(roomName)
    if (existing) {
      // Reuse only when the provider already broadcasts the caller's awareness;
      // otherwise the UI reads one awareness while the server relays another
      // (orphaned local presence shows up as phantom peers).
      if (!externalAwareness || existing.awareness === externalAwareness) {
        // A provider parked with `shouldConnect = false` (burned ticket, failed
        // rejoin) never reconnects on its own, and returning here would hide
        // that dead room for the rest of the session: repair it instead.
        if (!existing.wsconnected && !existing.shouldConnect) {
          const revived = await refreshProviderParams(roomName, existing)
          if (revived) {
            existing.shouldConnect = true
            existing.connect()
          }
        }
        return
      }
      // Same awareness object but a fresh `ydoc` emission for the same note:
      // the doc didn't change, so the live socket stays. Destroying it here is
      // what tore down presence on every re-emit.
      if (docToRoom.get(doc) === roomName) return
      detachNotificationListener(existing)
      existing.destroy()
      activeProviders.delete(roomName)
      forgetDocRoom(roomName)
    }
    // Realtime is an accelerator, never a prerequisite: without the room key
    // there is nothing safe to send, so don't open a socket at all. The durable
    // Rust path carries the changes; setRoomKey retries this join on arrival.
    if (!collabKeys.has(roomName)) {
      skipUnkeyedRoom(roomName, () => joinNoteRoom(noteId, doc, externalAwareness), 'note room')
      return
    }
    const join = (async () => {
      const wsUrl = getWebSocketUrl()
      if (!plaintextRelayAllowed(wsUrl)) {
        refusePlaintextRelay(wsUrl)
        return
      }
      const params = await getWsParams(workspaceId, noteId)
      if (leaveWhilePending.has(roomName)) {
        leaveWhilePending.delete(roomName)
        // A leave can also be the tail of a doc replacement; either way the join
        // ends without a provider, so name the room and the note.
        console.warn(
          `[ws-sync] join abandoned for room ${roomName} (note ${noteId}): room was left while the ticket fetch was in flight`,
        )
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
          // y-websocket sends awareness over the websocket ONLY from its
          // `awareness.on('update')` handler; its one-shot initial broadcast
          // lives in the BroadcastChannel path, which we disable. The page sets
          // the local state before the provider exists, so nothing fires that
          // handler and peers never learn about us: no avatars. Re-set the same
          // state to force the broadcast (null first, because y-protocols emits
          // nothing when the new state deep-equals the old one).
          rebroadcastLocalAwareness(awareness, roomName, `note ${noteId}`)
          notifySyncNow()
        } else if (status === 'disconnected') {
          scheduleRejoin(roomName, () => joinNoteRoom(noteId, doc, awareness))
        }
      })
      handleRejectedUpgrade(provider, roomName, () =>
        joinNoteRoom(noteId, doc, awareness),
      )
      // Attach immediately if already connecting
      attachNotificationListener(provider)

      activeProviders.set(roomName, provider)
      docToRoom.set(doc, roomName)
      // What `start()` needs to rebuild this room after a teardown.
      noteRoomArgs.set(roomName, { noteId, doc, awareness: externalAwareness })
      roomByNote.set(noteId, roomName)
    })()
    pendingRooms.set(roomName, join)
    try {
      await join
    } finally {
      // Clear our own entry so a rejected join can't wedge the room: the next
      // caller starts a fresh attempt instead of awaiting a dead promise.
      if (pendingRooms.get(roomName) === join) pendingRooms.delete(roomName)
    }
  }

  function leaveNoteRoom(noteId) {
    // The join-time room name first: after a revoked share the note's
    // `access` is gone, so re-resolving the workspace here would build the
    // active workspace's room, never find the owner-workspace provider, and
    // leave a ghost socket in a 403 rejoin loop (finding 17).
    const roomName =
      roomByNote.get(noteId) ||
      buildRoomName(resolveNoteWorkspaceId(noteId, getActiveWorkspaceId() || ''), noteId)
    roomByNote.delete(noteId)
    clearRejoin(roomName)
    pendingKeyJoins.delete(roomName)
    // Leaving drops the parked entry too, or a stale closure would re-join a
    // room the user already left once a key arrives.
    pendingKeyJoins.delete(parkedNoteJoinKey(noteId))
    const provider = activeProviders.get(roomName)
    if (provider) {
      detachNotificationListener(provider)
      provider.destroy()
      activeProviders.delete(roomName)
    } else if (pendingRooms.has(roomName)) {
      leaveWhilePending.add(roomName)
    }
    forgetDocRoom(roomName)
    noteRoomArgs.delete(roomName)
    unregisterActiveDoc(noteId)
  }

  async function joinMetaRoom(workspaceId) {
    const roomName = buildMetaRoomName(workspaceId)
    if (activeProviders.has(roomName) || pendingRooms.has(roomName)) return
    pendingRooms.set(roomName, Promise.resolve())
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
      if (!plaintextRelayAllowed(wsUrl)) {
        refusePlaintextRelay(wsUrl)
        return
      }
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
      metaRoomAwareness.value = provider.awareness

      // On connection/reconnection: re-attach notification listener, trigger a
      // pull to catch up on anything missed while disconnected, and force the
      // local presence broadcast (see rebroadcastLocalAwareness).
      provider.on('status', ({ status }) => {
        if (status === 'connected') {
          reconnectAttempts.delete(roomName)
          attachNotificationListener(provider)
          rebroadcastLocalAwareness(metaRoomAwareness.value, roomName, 'meta room')
          notifySyncNow()
        } else if (status === 'disconnected') {
          scheduleRejoin(roomName, () => joinMetaRoom(workspaceId))
        }
      })
      handleRejectedUpgrade(provider, roomName, () => joinMetaRoom(workspaceId))
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

  // iOS suspends the webview: on resume the sockets are dead and their
  // single-use tickets were already redeemed, so y-websocket's own retry 401s
  // and the provider parks with `shouldConnect = false` — the room then stays
  // silent for the rest of the session. Reopen every dead room with a fresh one.
  async function repairRealtime() {
    if (!isAuthenticated()) return
    for (const [roomName, provider] of Array.from(activeProviders)) {
      if (provider.wsconnected) continue
      detachNotificationListener(provider)
      provider.shouldConnect = false
      let revived = false
      try {
        revived = await refreshProviderParams(roomName, provider)
      } catch (err) {
        console.warn(`[ws-sync] resume repair of ${roomName} failed: ${err?.message || err}`)
      }
      if (revived) {
        provider.shouldConnect = true
        provider.connect()
        continue
      }
      provider.destroy()
      activeProviders.delete(roomName)
      clearRejoin(roomName)
    }
    // Whatever did not come back above is re-joined exactly as `start()` does.
    const workspaceId = getActiveWorkspaceId()
    if (workspaceId) {
      const metaRoom = buildMetaRoomName(workspaceId)
      if (!activeProviders.has(metaRoom) && !pendingRooms.has(metaRoom)) {
        fireAndLog(joinMetaRoom(workspaceId), `meta room join on repair of ${metaRoom}`)
      }
    }
    for (const [roomName, args] of Array.from(noteRoomArgs.entries())) {
      if (activeProviders.has(roomName) || pendingRooms.has(roomName)) continue
      try {
        fireAndLog(
          joinNoteRoom(args.noteId, args.doc, args.awareness),
          `re-join of ${roomName} on repair`,
        )
      } catch {
        /* Realtime is an accelerator: a failed repair costs only live updates. */
      }
    }
  }

  function disconnect() {
    for (const [, provider] of activeProviders) {
      detachNotificationListener(provider)
      // destroy, not disconnect: a disconnected provider keeps its doc,
      // awareness and interval listeners alive and would replay a burned
      // ticket if anything called connect() on it later.
      provider.destroy()
    }
    for (const room of reconnectTimers.keys()) clearRejoin(room)
    for (const room of pendingRooms.keys()) leaveWhilePending.add(room)
    activeProviders.clear()
    docToRoom.clear()
    collabKeys.clear()
    pendingKeyJoins.clear()
    // Note rooms carry the previous account's decrypted Y.Docs; sign-out must
    // not replay them into a new sign-in within the same session.
    noteRoomArgs.clear()
    roomByNote.clear()
    metaRoomAwareness.value = null
    clearUnwrappedKeyCache()
    clearWorkspaceKeyCache()
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
        fireAndLog(joinMetaRoom(workspaceId), `meta room join on start of ${metaRoom}`)
      }
    }
    // Note rooms too: nothing else re-joins them once their provider is gone,
    // and `handleNoteSwitch` has no callers, so a stop/start cycle would leave
    // every open note without realtime for the rest of the session.
    for (const [roomName, args] of Array.from(noteRoomArgs.entries())) {
      try {
        Promise.resolve(joinNoteRoom(args.noteId, args.doc, args.awareness)).catch(
          (err) =>
            console.warn(
              `[ws-sync] re-join of ${roomName} on start failed: ${err?.message || err}`,
            ),
        )
      } catch (err) {
        console.warn(
          `[ws-sync] re-join of ${roomName} on start failed: ${err?.message || err}`,
        )
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
    for (const room of pendingRooms.keys()) leaveWhilePending.add(room)
    for (const room of pendingKeyJoins.keys()) pendingKeyJoins.delete(room)
    for (const [doc, roomName] of docToRoom) {
      if (roomName.startsWith('workspace:')) {
        docToRoom.delete(doc)
      }
    }
    metaRoomAwareness.value = null

    if (isAuthenticated()) {
      fireAndLog(joinMetaRoom(workspaceId), `meta room join on workspace switch to ${workspaceId}`)
    }
  }

  function handleNoteSwitch(noteId, doc) {
    for (const [roomName] of activeProviders) {
      if (roomName.endsWith(`:note:${noteId}`)) return
    }
    fireAndLog(joinNoteRoom(noteId, doc), `note room join on switch to note ${noteId}`)
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

  // Workspace-scope presence: the meta room's awareness, when joined. Callers
  // treat it as a getter fn for usePresence's resolveAwareness.
  function getMetaAwareness() {
    return metaRoomAwareness
  }

  return {
    start,
    stop: disconnect,
    connect,
    repairRealtime,
    disconnect,
    joinNoteRoom,
    leaveNoteRoom,
    joinMetaRoom,
    getMetaAwareness,
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
