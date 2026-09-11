import { getApiClient } from './client';
import { getSyncDeviceId } from '@/utils/sync/sync-repository';

export async function listCommits(workspaceId, noteId) {
  const client = getApiClient();
  const response = await client.get('/commits/history', {
    query: { noteId },
  });
  // listHistory returns `commitId`; expose it as `hash` too since the
  // history UI and sync restore look up snapshots by `hash`.
  return (response?.commits || []).map((c) => ({
    ...c,
    hash: c.hash ?? c.commitId ?? c.id ?? c.commitHash,
  }));
}

export async function getCommitSnapshot(commitHash, noteId = '') {
  const client = getApiClient();
  const response = await client.get(
    `/commits/${encodeURIComponent(commitHash)}`
  );
  const payload = response?.data || response;

  // Server returns the v4/v5 sync envelope as a JSON string. The snapshot
  // ({ content, title }) lives in the envelope's encrypted meta, so decrypt
  // and return it directly. Anything else is undecryptable here → null.
  if (typeof payload === 'string') {
    try {
      const { decryptJSON } = await import('@/utils/sync/crypto.js');
      const decrypted = await decryptJSON(payload, noteId);
      if (decrypted?.content || decrypted?.title) return decrypted;
    } catch (err) {
      console.warn('[history] failed to decrypt commit snapshot:', err?.message);
    }
    return null;
  }

  // Server returns the encrypted envelope { v, nonce, cipher }.
  // Decrypt it client-side with the sync key to get plaintext content.
  if (payload && payload.v && payload.nonce && payload.cipher) {
    try {
      const { decryptJSON } = await import('@/utils/sync/crypto.js');
      const decrypted = await decryptJSON(payload, noteId);
      if (decrypted?.update) {
        const text = new TextDecoder().decode(decrypted.update);
        return JSON.parse(text);
      }
    } catch (err) {
      console.warn('[history] failed to decrypt commit snapshot:', err?.message);
    }
  }

  return null;
}

/**
 * Create a version history commit for a note (`snapshot` = HTML content + title).
 */
export async function createCommit(noteId, snapshot, opts = {}) {
  const { encryptJSON } = await import('@/utils/sync/crypto.js');
  const client = getApiClient(opts.baseUrl ? { baseUrl: opts.baseUrl } : undefined);

  const deviceId = await getSyncDeviceId();
  const ts = Date.now();
  const clock = ts;

  const updateBytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const encrypted = await encryptJSON({ update: updateBytes, noteId, ts }, noteId);

  const commitId = `${clock}-${deviceId}-${clock}`;

  await client.post('/commits', {
    id: commitId,
    deviceId,
    clock,
    ts,
    payload: encrypted,
  }, {
    headers: {
      'X-Device-Id': deviceId,
      'X-Note-Id': noteId,
    },
  });
}
