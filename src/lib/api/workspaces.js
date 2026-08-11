import { getApiClient, ApiError } from './client';
import { useAccountStore } from '@/store/account';
import { loadOrCreateIdentity } from '@/utils/crypto/identity';
import { importCollabKey } from '@/utils/crypto/collab';
import { bytesToHex } from '@/utils/crypto/hex';
import { wrapNoteKeyForRecipient, unwrapNoteKey } from '@/utils/crypto/note-key';
import { encryptName, decryptName } from '@/utils/crypto/comment-crypto';

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
  return {
    nameEncrypted,
    recipients: [{ userId, wrappedKey }],
    orgId,
  };
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
  const payload = await provisionWorkspacePayload(name);
  return client.post('/workspaces', payload, { signal });
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
  return client.post(
    `/workspaces/${encodeURIComponent(workspaceId)}/members`,
    { identifier, role },
    { signal }
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
