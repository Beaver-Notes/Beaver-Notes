import { getApiClient, ApiError } from './client';
import { useAccountStore } from '@/store/account';
import { loadOrCreateIdentity } from '@/utils/crypto/identity';
import { importCollabKey } from '@/utils/crypto/collab';
import { bytesToHex } from '@/utils/crypto/hex';
import { wrapNoteKeyForRecipient, recoverNoteKeyFromEnvelopes } from '@/utils/crypto/note-key';
import { encryptName, decryptName } from '@/utils/crypto/comment-crypto';
import { encryptJSON, decryptJSON } from '@/utils/sync/crypto';
import {
  isEncryptionAvailable,
  encryptString,
  decryptString,
  storeSecureBlob,
  fetchSecureBlob,
  clearSecureBlob,
} from '@/lib/native/security';
import { settingsMirrorKey } from '@/lib/settings';

// AAD domain binding vault-wrapped workspace key envelopes to their purpose,
// so they can never be replayed as (or from) regular sync payloads.
export const VAULT_WRAPPED_KEYS_AAD = 'beaver-workspace-keys:v1';

// Raw workspace keys by workspace id. Seeded when we create a workspace and
// after recovering the key via the vault key on join; consumers
// (ensureMetaRoomKey, workspace name encryption) check it before falling back
// to the network fetch + ML-KEM unwrap path.
const workspaceKeyCache = new Map();

// Mirror of the cache in the per-instance settings namespace, so a restart
// still has the key instead of having to re-unwrap it from the server.
// One blob, not one key per workspace: sign-out clears it in a single call.
//
// SC-1-02: the mirror is a credential (it is the E2E root for every workspace
// note), so it is persisted the same way as session tokens — safeStorage-
// encrypted (OS keyring) in a secure blob plus an encrypted localStorage
// mirror, never in plaintext. The pre-fix plaintext mirror under
// `workspace-keys` is migrated once on the first read and then deleted.
const WORKSPACE_KEYS_MIRROR = 'workspace-keys-v2';
const WORKSPACE_KEYS_LEGACY_MIRROR = 'workspace-keys';
const WORKSPACE_KEYS_BLOB = 'workspaceKeysSecure';
const WORKSPACE_KEY_HEX = /^[0-9a-f]{64}$/;

function safeStorageAvailable() {
  return isEncryptionAvailable().catch(() => false);
}

function toBase64(input) {
  if (typeof btoa === 'function') {
    try {
      return btoa(unescape(encodeURIComponent(input)));
    } catch {
      return input;
    }
  }
  return input;
}

function fromBase64(base64) {
  if (!base64) return '';
  if (typeof atob !== 'function') return base64;
  try {
    return decodeURIComponent(escape(atob(base64)));
  } catch {
    return base64;
  }
}

function sanitizePersistedKeys(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const keys = {};
  for (const [id, hex] of Object.entries(parsed)) {
    if (typeof id === 'string' && typeof hex === 'string' && WORKSPACE_KEY_HEX.test(hex)) {
      keys[id] = hex;
    }
  }
  return keys;
}

// Pre-fix plaintext mirror: legacy plaintext keys are read once, seeded into
// the cache, persisted securely, and then deleted.
function readLegacyPlaintextKeys() {
  try {
    const raw = localStorage.getItem(settingsMirrorKey(WORKSPACE_KEYS_LEGACY_MIRROR));
    const parsed = raw ? JSON.parse(raw) : null;
    return sanitizePersistedKeys(parsed);
  } catch {
    return {};
  }
}

function seedCache(keys) {
  for (const [id, hex] of Object.entries(keys)) workspaceKeyCache.set(id, hex);
}

// Producing the safeStorage cipher is async, so it can race a clear (account
// switch / sign-out). The write is separated from the production and dropped
// when `clearGeneration` moved meanwhile: a late write must never re-persist
// the previous account's keys.
async function buildWorkspaceKeysCipher() {
  if (!(await safeStorageAvailable())) return null;
  if (workspaceKeyCache.size === 0) return null;
  return encryptString(toBase64(JSON.stringify(Object.fromEntries(workspaceKeyCache))));
}

function writeWorkspaceKeysCipher(cipher, generation) {
  // Never fall back to a plaintext write.
  if (generation !== clearGeneration) return;
  try {
    localStorage.setItem(settingsMirrorKey(WORKSPACE_KEYS_MIRROR), cipher);
  } catch {
    // Mirror is best-effort; the in-memory cache still serves this session.
  }
  if (generation !== clearGeneration) return;
  storeSecureBlob(WORKSPACE_KEYS_BLOB, cipher).catch(() => {});
}

// Persists are serialized so the LAST snapshot (always the fullest) wins on
// disk, and a queued persist is dropped once a clear happened — before the
// async work AND again between producing the cipher and each write.
let persistChain = Promise.resolve();
let clearGeneration = 0;

function queuePersistWorkspaceKeys() {
  const generation = clearGeneration;
  persistChain = persistChain
    .then(async () => {
      if (generation !== clearGeneration) return;
      const cipher = await buildWorkspaceKeysCipher();
      writeWorkspaceKeysCipher(cipher, generation);
    })
    .catch(() => {});
}

let hydratePromise = null;

// Cold start: read the legacy plaintext mirror (migrate + delete), then the
// encrypted blob / mirror, and seed the in-memory cache. Idempotent; the first
// caller's promise is shared so concurrent recovery paths do not race.
export function hydrateWorkspaceKeys() {
  if (!hydratePromise) {
    hydratePromise = (async () => {
      const legacy = readLegacyPlaintextKeys();
      if (Object.keys(legacy).length) {
        seedCache(legacy);
        // Generation-guarded: a clear racing the hydrate must not re-persist
        // the previous account's keys. Deleting the plaintext immediately is
        // always safe — it shortens the plaintext's life on disk.
        queuePersistWorkspaceKeys();
        try {
          localStorage.removeItem(settingsMirrorKey(WORKSPACE_KEYS_LEGACY_MIRROR));
        } catch {
          // Nothing left behind if the key was never written.
        }
        return;
      }
      if (!(await safeStorageAvailable())) return;
      let cipher = null;
      try {
        cipher = await fetchSecureBlob(WORKSPACE_KEYS_BLOB);
      } catch {
        cipher = null;
      }
      if (!cipher) {
        try {
          cipher = localStorage.getItem(settingsMirrorKey(WORKSPACE_KEYS_MIRROR));
        } catch {
          cipher = null;
        }
      }
      if (!cipher) return;
      try {
        const plain = fromBase64(await decryptString(cipher));
        seedCache(sanitizePersistedKeys(JSON.parse(plain)));
      } catch {
        // Undecryptable mirror (locked keyring, corrupt row): the network
        // recovery path re-fetches the key instead of failing the app.
      }
    })().catch(() => {});
  }
  return hydratePromise;
}

export function getCachedWorkspaceKey(workspaceId) {
  // In-memory cache only: the persisted mirror is decrypted asynchronously
  // (OS keyring IPC), so it cannot be read on this sync path. Recovery paths
  // await hydrateWorkspaceKeys() before falling back to the network.
  return workspaceKeyCache.get(workspaceId) ?? null;
}

export function setCachedWorkspaceKey(workspaceId, workspaceKeyHex) {
  if (!workspaceId || typeof workspaceKeyHex !== 'string' || !workspaceKeyHex) return;
  workspaceKeyCache.set(workspaceId, workspaceKeyHex);
  // Fire-and-forget: callers are sync contexts. A failed persist keeps this
  // session working from memory and re-wraps from the server next start.
  queuePersistWorkspaceKeys();
}

/**
 * Drop every cached workspace key, on disk too. The cache outlives sign-out
 * otherwise, so the next account inherits the previous account's key material.
 */
export function clearWorkspaceKeyCache() {
  workspaceKeyCache.clear();
  clearGeneration += 1;
  try {
    localStorage.removeItem(settingsMirrorKey(WORKSPACE_KEYS_MIRROR));
    localStorage.removeItem(settingsMirrorKey(WORKSPACE_KEYS_LEGACY_MIRROR));
  } catch {
    // Nothing to clear if the mirror was never written.
  }
  // The blob wipe rides the same chain as persists: everything queued before
  // this either completed (and is wiped now) or was generation-dropped, so a
  // late persist write can never resurrect the previous account's keys.
  persistChain = persistChain
    .then(() => clearSecureBlob(WORKSPACE_KEYS_BLOB))
    .catch(() => {
      // Best-effort: the Rust-side blob is dropped on lock as well.
    });
  hydratePromise = null;
}

/** Wrap workspace key under session AEK so members recovering passphrase re-derive locally. Returns base64 envelope. */
export async function buildVaultWrappedKeys(workspaceKeyHex) {
  const payload = new TextEncoder().encode(JSON.stringify({ workspaceKey: workspaceKeyHex }));
  return encryptJSON(
    {
      update: payload,
      device: 'beaver-vault',
      ts: Date.now(),
      noteId: 'workspace-keys',
    },
    VAULT_WRAPPED_KEYS_AAD
  );
}

/** Inverse of buildVaultWrappedKeys: decrypt envelope, recover workspaceKeyHex. Null on bad input or locked key, best-effort. */
export async function unwrapWorkspaceKeysFromVault(vaultWrappedKeys) {
  if (!vaultWrappedKeys || typeof vaultWrappedKeys !== 'string') return null;
  try {
    const res = await decryptJSON(vaultWrappedKeys, VAULT_WRAPPED_KEYS_AAD);
    if (!res?.update) return null;
    const decoded = JSON.parse(new TextDecoder().decode(res.update));
    const workspaceKeyHex = decoded?.workspaceKey;
    return typeof workspaceKeyHex === 'string' && workspaceKeyHex
      ? { workspaceKeyHex }
      : null;
  } catch {
    return null;
  }
}

function getClient(baseUrl) {
  return getApiClient(baseUrl ? { baseUrl } : undefined);
}

async function provisionWorkspacePayload(name) {
  const accountStore = useAccountStore();
  const userId = accountStore.profile?.id || null;
  const orgId = accountStore.activeOrgId || accountStore.profile?.organizationId || null;
  const identity = await loadOrCreateIdentity();
  // An organization is a Team/Enterprise concept: a Basic-plan account has no
  // org, so it must not block workspace creation. The server accepts an
  // optional orgId and only needs the owner's encryption identity to wrap the
  // workspace key.
  if (!identity?.publicKeyHex || !userId) {
    throw new ApiError('Cannot create workspace: missing encryption identity.');
  }

  const workspaceKeyHex = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const wrappedKey = await wrapNoteKeyForRecipient(identity.publicKeyHex, workspaceKeyHex);
  const key = await importCollabKey(workspaceKeyHex);
  const nameEncrypted = await encryptName(key, name);
  // Passphrase-recoverable copy of the workspace key, stored server-side so
  // members who adopt the vault key can unwrap it without ML-KEM.
  const vaultWrappedKeys = await buildVaultWrappedKeys(workspaceKeyHex);
  const body = {
    nameEncrypted,
    recipients: [{ userId, wrappedKey }],
    orgId,
    vaultWrappedKeys,
  };
  return { body, workspaceKeyHex };
}

async function decryptWorkspaceName(ws, identity) {
  const base = { ...ws, name: ws.name || '' };
  if (!ws?.nameEncrypted || !identity?.privateKeyHex) {
    return base;
  }
  try {
    // Device envelopes first, then the legacy items-key envelope, so a
    // workspace created before per-device envelopes still decrypts its name.
    const workspaceKeyHex = await recoverWorkspaceKeyFromRecord(ws, identity);
    if (!workspaceKeyHex) return base;
    const key = await importCollabKey(workspaceKeyHex);
    return { ...base, name: await decryptName(key, ws.nameEncrypted) };
  } catch (err) {
    console.warn('[workspaces] failed to decrypt workspace name:', err?.message || err);
    return base;
  }
}

// A workspace record may carry per-device envelopes (`wrappedKeys`) plus the
// legacy account-level `wrappedKey`. Normalize to a list the recovery helper
// can walk; device envelopes before the legacy (deviceId null) one. Only the
// matching device's private key unwraps, so order is just a fast path — the
// walk also covers a re-linked device and post-rotation retries.
function workspaceKeyEnvelopes(ws) {
  const list = Array.isArray(ws?.wrappedKeys) && ws.wrappedKeys.length
    ? ws.wrappedKeys
    : (ws?.wrappedKey ? [{ deviceId: null, wrappedKey: ws.wrappedKey }] : []);
  return [...list].sort((a, b) => {
    const rank = (e) => (e?.deviceId == null ? 1 : 0);
    return rank(a) - rank(b);
  });
}

export async function getWorkspaces({ baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  const raw = await client.get('/workspaces', { signal });
  const list = raw?.workspaces ?? [];
  const needsIdentity = list.some(
    (ws) =>
      ws?.nameEncrypted &&
      (ws?.wrappedKey || (ws?.wrappedKeys && ws.wrappedKeys.length) || ws?.vaultWrappedKeys)
  );
  const identity = needsIdentity
    ? await loadOrCreateIdentity().catch(() => null)
    : null;
  const workspaces = [];
  for (const ws of list) {
    workspaces.push(await decryptWorkspaceName(ws, identity));
  }
  return workspaces;
}

export async function createWorkspace(name, options = {}) {
  const { baseUrl, signal, emoji, color } = options;
  const client = getClient(baseUrl);
  const { body, workspaceKeyHex } = await provisionWorkspacePayload(name);
  if (emoji) body.emoji = emoji;
  if (color) body.color = color;
  const res = await client.post('/workspaces', body, { signal });
  if (res?.id) setCachedWorkspaceKey(res.id, workspaceKeyHex);
  return res;
}

export async function renameWorkspace(id, nameEncrypted, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.patch(`/workspaces/${encodeURIComponent(id)}`, { nameEncrypted }, { signal });
}

export async function updateWorkspaceDecoration(id, { emoji, color, baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.patch(`/workspaces/${encodeURIComponent(id)}`, { emoji, color }, { signal });
}

export async function deleteWorkspace(id, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.delete(`/workspaces/${encodeURIComponent(id)}`, { signal });
}

export async function addMember(workspaceId, identifier, role = 'editor', { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  const body = /\S+@\S+\.\S+/.test(identifier.trim())
    ? { email: identifier.trim().toLowerCase(), role }
    : { username: identifier.trim().toLowerCase(), role };
  return client.post(
    `/workspaces/${encodeURIComponent(workspaceId)}/members`,
    body,
    { baseUrl, signal }
  );
}

export async function removeMember(workspaceId, userId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.delete(
    `/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`,
    { signal }
  );
}

export async function joinWorkspace(token, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.post(`/workspaces/join/${encodeURIComponent(token)}`, {}, { signal });
}

export async function listAllWorkspaceJoinRequests({ baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  const res = await client.get('/workspaces/join-requests', { signal });
  return res?.requests ?? [];
}

export async function listMyPendingWorkspaceRequests({ baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  const res = await client.get('/workspaces/my-pending-requests', { signal });
  return res?.requests ?? [];
}

export async function approveWorkspaceJoinRequest(requestId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.post(
    `/workspaces/join-requests/${encodeURIComponent(requestId)}/approve`,
    {},
    { signal }
  );
}

export async function denyWorkspaceJoinRequest(requestId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.post(
    `/workspaces/join-requests/${encodeURIComponent(requestId)}/deny`,
    {},
    { signal }
  );
}

export async function getWorkspaceMembers(workspaceId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.get(`/workspaces/${encodeURIComponent(workspaceId)}/members`, { signal });
}

export async function provisionWorkspaceKey(workspaceId, recipients, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.post(`/workspaces/${encodeURIComponent(workspaceId)}/keys`, { recipients }, { signal });
}

// Every member device's KEM public key plus whether it already holds a
// workspace-key envelope. Mirrors /collaboration/public-keys: the key-holder
// wraps only for devices the server reports `hasEnvelope: false`.
export async function getWorkspacePublicKeys(workspaceId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  const res = await client.get(
    `/workspaces/${encodeURIComponent(workspaceId)}/public-keys`,
    { signal }
  );
  return Array.isArray(res?.collaborators) ? res.collaborators : [];
}

// The caller's raw workspace record, or null when they are not a member.
export async function getWorkspaceKeyRecord(workspaceId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  const raw = await client.get('/workspaces', { signal });
  const list = Array.isArray(raw) ? raw : (raw?.workspaces ?? []);
  return list.find((w) => w.id === workspaceId) ?? null;
}

// All of the caller's envelopes for a workspace: per-device plus the legacy
// account-level one. Returns [] when the caller holds none.
export async function getWorkspaceKey(workspaceId, { baseUrl, signal } = {}) {
  const ws = await getWorkspaceKeyRecord(workspaceId, { baseUrl, signal });
  return ws ? workspaceKeyEnvelopes(ws) : [];
}

// Recover the raw workspace key for this device with no password. Device KEM
// envelopes are tried first (the note_keys model): a cold device that holds
// only its own private key reads its envelope directly. The legacy items-key
// (session AEK) envelope is the fallback for rows written before per-device
// envelopes existed. Never prompts and never rotates: returns null when
// nothing unwraps. Caches on a hit.
export async function recoverWorkspaceKeyFromRecord(ws, identity) {
  if (!ws?.id || !identity?.privateKeyHex) return null;

  const envelopes = workspaceKeyEnvelopes(ws);
  if (envelopes.length > 0) {
    const fromDevice = await recoverNoteKeyFromEnvelopes(envelopes, identity, ws.id);
    if (fromDevice) {
      setCachedWorkspaceKey(ws.id, fromDevice);
      return fromDevice;
    }
  }

  // Legacy path: sealed under the account items key, so only a device that
  // currently holds that key can unwrap it. decryptJSON throws when the app is
  // locked or the row is foreign; that is equivalent to "no envelope here".
  const legacy = await unwrapWorkspaceKeysFromVault(ws.vaultWrappedKeys).catch(() => null);
  if (legacy?.workspaceKeyHex) {
    setCachedWorkspaceKey(ws.id, legacy.workspaceKeyHex);
    return legacy.workspaceKeyHex;
  }

  return null;
}

// Cache-first recovery by workspace id. Used by the meta-room/sync paths to
// key a second device that never held the account-level envelope.
export async function recoverWorkspaceKeyHex(workspaceId, identity, { baseUrl, signal } = {}) {
  const cached = getCachedWorkspaceKey(workspaceId);
  if (cached) return cached;
  if (!identity?.privateKeyHex) return null;
  // Cold start: decrypt the persisted mirror into the cache before falling
  // back to a network round-trip for the record.
  await hydrateWorkspaceKeys();
  const hydrated = getCachedWorkspaceKey(workspaceId);
  if (hydrated) return hydrated;
  let ws;
  try {
    ws = await getWorkspaceKeyRecord(workspaceId, { baseUrl, signal });
  } catch {
    return null;
  }
  if (!ws) return null;
  return recoverWorkspaceKeyFromRecord(ws, identity);
}
