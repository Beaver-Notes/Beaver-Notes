import { getApiClient, ApiError } from './client';
import { useAccountStore } from '@/store/account';
import { loadOrCreateIdentity } from '@/utils/crypto/identity';
import { importCollabKey } from '@/utils/crypto/collab';
import { bytesToHex } from '@/utils/crypto/hex';
import { wrapNoteKeyForRecipient, unwrapNoteKey } from '@/utils/crypto/note-key';
import { encryptName, decryptName } from '@/utils/crypto/comment-crypto';
import { encryptJSON, decryptJSON } from '@/utils/sync/crypto';

// AAD domain binding vault-wrapped workspace key envelopes to their purpose,
// so they can never be replayed as (or from) regular sync payloads.
export const VAULT_WRAPPED_KEYS_AAD = 'beaver-workspace-keys:v1';

// Raw workspace keys by workspace id. Seeded when we create a workspace and
// after recovering the key via the vault passphrase on join; consumers
// (ensureMetaRoomKey, workspace name encryption) check it before falling back
// to the network fetch + ML-KEM unwrap path.
const workspaceKeyCache = new Map();

export function getCachedWorkspaceKey(workspaceId) {
  return workspaceKeyCache.get(workspaceId) ?? null;
}

export function setCachedWorkspaceKey(workspaceId, workspaceKeyHex) {
  if (!workspaceId || typeof workspaceKeyHex !== 'string' || !workspaceKeyHex) return;
  workspaceKeyCache.set(workspaceId, workspaceKeyHex);
}

/**
 * Wrap the raw workspace key under the session AEK so any member who recovers
 * their encryption password (vault passphrase adoption) can re-derive the
 * workspace key locally instead of waiting for an ML-KEM re-wrap.
 * Returns the base64 envelope string stored server-side as vault_wrapped_keys.
 */
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

/**
 * Inverse of buildVaultWrappedKeys: decrypt the envelope with the session AEK
 * and recover `{ workspaceKeyHex }`. Returns null for missing/tampered input
 * or a locked key rather than throwing — recovery is best-effort.
 */
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
  if (!identity?.publicKeyHex || !userId || !orgId) {
    throw new ApiError('Cannot create workspace: missing encryption identity or organization.');
  }

  const workspaceKeyHex = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const wrappedKey = await wrapNoteKeyForRecipient(identity.publicKeyHex, workspaceKeyHex);
  const key = await importCollabKey(workspaceKeyHex);
  const nameEncrypted = await encryptName(key, name);
  // Passphrase-recoverable copy of the workspace key, stored server-side so
  // members who adopt the vault passphrase can unwrap it without ML-KEM.
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
  if (!ws?.nameEncrypted || !ws?.wrappedKey || !identity?.privateKeyHex) {
    return base;
  }
  try {
    const workspaceKeyHex = await unwrapNoteKey(identity.privateKeyHex, ws.wrappedKey);
    const key = await importCollabKey(workspaceKeyHex);
    return { ...base, name: await decryptName(key, ws.nameEncrypted) };
  } catch (err) {
    console.warn('[workspaces] failed to decrypt workspace name:', err?.message || err);
    return base;
  }
}

export async function getWorkspaces({ baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  const raw = await client.get('/workspaces', { signal });
  const list = raw?.workspaces ?? [];
  const needsIdentity = list.some((ws) => ws?.nameEncrypted && ws?.wrappedKey);
  const identity = needsIdentity
    ? await loadOrCreateIdentity().catch(() => null)
    : null;
  const workspaces = [];
  for (const ws of list) {
    workspaces.push(await decryptWorkspaceName(ws, identity));
  }
  return workspaces;
}

export async function createWorkspace(name, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  const { body, workspaceKeyHex } = await provisionWorkspacePayload(name);
  const res = await client.post('/workspaces', body, { signal });
  if (res?.id) setCachedWorkspaceKey(res.id, workspaceKeyHex);
  return res;
}

export async function renameWorkspace(id, nameEncrypted, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.patch(`/workspaces/${encodeURIComponent(id)}`, { nameEncrypted }, { signal });
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

export async function getWorkspaceMembers(workspaceId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.get(`/workspaces/${encodeURIComponent(workspaceId)}/members`, { signal });
}

export async function provisionWorkspaceKey(workspaceId, userId, wrappedKey, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.post(`/workspaces/${encodeURIComponent(workspaceId)}/keys`, { userId, wrappedKey }, { signal });
}

export async function getWorkspaceKey(workspaceId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  const raw = await client.get('/workspaces', { signal });
  const ws = (raw?.workspaces ?? []).find((w) => w.id === workspaceId);
  return ws?.wrappedKey ?? null;
}
