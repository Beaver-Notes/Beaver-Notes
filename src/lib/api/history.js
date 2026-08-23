import { getApiClient } from './client';
import { getSyncDeviceId } from '@/utils/sync/sync-repository';

export async function listCommits(workspaceId, noteId) {
  const client = getApiClient();
  const response = await client.get('/commits/history', {
    query: { noteId },
  });
  return response?.commits || [];
}

export async function getCommitSnapshot(commitHash, noteId = '') {
  const client = getApiClient();
  const response = await client.get(
    `/commits/${encodeURIComponent(commitHash)}`
  );
  const payload = response?.data || response;

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

  return payload;
}

/**
 * Create a version history commit for a note.
 * @param {string} noteId
 * @param {{ content: string, title: string }} snapshot - HTML content + title
 * @param {object} [opts]
 * @param {string} [opts.baseUrl]
 */
export async function createCommit(noteId, snapshot, opts = {}) {
  const { encryptJSON } = await import('@/utils/sync/crypto.js');
  const client = getApiClient(opts.baseUrl ? { baseUrl: opts.baseUrl } : undefined);

  const deviceId = getSyncDeviceId();
  const ts = Date.now();
  const clock = ts;

  // Encrypt the snapshot with the sync key
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
