import { getApiClient } from './client';
import { getSyncDeviceId } from '@/utils/sync/sync-repository';
import { bufToBase64, base64ToBuf } from '@/utils/crypto/codec.js';

// Commit snapshot envelope versions:
//   v4/v5 - legacy/items-key Rust envelope (`encryptJSON`). Personal notes.
//   v6    - shared note-key envelope (AES-GCM with the per-note key comments
//           use) so every collaborator can decrypt and items-key rotation
//           cannot strand the snapshot.
const NOTE_KEY_ENVELOPE_VERSION = 6;

/**
 * Resolve the shared per-note key (hex) when one exists. Cached keys skip the
 * ML-KEM unwrap. Returns null for personal/non-collaboration notes, which fall
 * back to the items key.
 */
async function resolveCommitKey(noteId) {
  if (!noteId) return null;
  try {
    const { getCachedNoteKey } = await import('@/utils/crypto/note-key.js');
    const cached = getCachedNoteKey(noteId);
    if (cached) return cached;
    const { useNoteSharing } = await import('@/composable/useNoteSharing');
    return (await useNoteSharing().ensureNoteKey(noteId)) || null;
  } catch {
    return null;
  }
}

export async function listCommits(workspaceId, noteId) {
  const client = getApiClient();
  const response = await client.get('/commits/history', {
    query: { noteId },
  });
  // listHistory returns `commitId`; expose it as `hash` too since the
  // history UI and sync restore look up snapshots by `hash`.
  // The server selects unquoted `AS commitId` / `AS createdAt` aliases, which
  // Postgres folds to lowercase on the wire (`commitid`, `createdat`, ...),
  // so accept both shapes here.
  return (response?.commits || []).map((c) => ({
    ...c,
    hash: c.hash ?? c.commitId ?? c.commitid ?? c.id ?? c.commitHash,
    createdAt: c.createdAt ?? c.createdat ?? c.ts ?? c.clock,
    authorName: c.authorName ?? c.authorname,
    deviceLabel: c.deviceLabel ?? c.devicelabel,
  }));
}

export async function getCommitSnapshot(commitHash, noteId = '') {
  const client = getApiClient();
  const response = await client.get(
    `/commits/${encodeURIComponent(commitHash)}`,
    // X-Note-Id lets the server authorise a collaborator (not just the pusher)
    // to fetch the blob and pick the right storage prefix.
    noteId ? { headers: { 'X-Note-Id': noteId } } : undefined
  );
  const payload = response?.data || response;

  // Self-describing envelope: v6 is the shared note-key format, decrypted with
  // the per-note key. Anything else is the legacy items-key envelope.
  let parsed = null;
  if (typeof payload === 'string') {
    try {
      parsed = JSON.parse(payload);
    } catch {
      parsed = null;
    }
  }

  if (parsed?.v === NOTE_KEY_ENVELOPE_VERSION) {
    try {
      const sourceNoteId = parsed.noteId || noteId;
      const noteKeyHex = await resolveCommitKey(sourceNoteId);
      if (!noteKeyHex) return null;
      const { importCollabKey, decryptUpdate } = await import(
        '@/utils/crypto/collab.js'
      );
      const key = await importCollabKey(noteKeyHex);
      const plaintext = await decryptUpdate(
        key,
        base64ToBuf(parsed.data),
        sourceNoteId
      );
      return JSON.parse(new TextDecoder().decode(plaintext));
    } catch (err) {
      console.warn(
        '[history] failed to decrypt note-key commit snapshot:',
        err?.message
      );
      return null;
    }
  }

  // Legacy items-key path. `createCommit` encrypts
  // `{ update: <JSON {content,title}>, device, noteId, ts }` with the noteId as
  // AAD, so after decryption the snapshot lives in `update`.
  if (typeof payload !== 'string') return null;

  try {
    const { decryptJSON } = await import('@/utils/sync/crypto.js');
    const decrypted = await decryptJSON(payload, noteId);
    if (!decrypted?.update) return null;
    const text = new TextDecoder().decode(decrypted.update);
    return JSON.parse(text);
  } catch (err) {
    console.warn('[history] failed to decrypt commit snapshot:', err?.message);
    return null;
  }
}

/**
 * Create a version history commit for a note (`snapshot` = HTML content + title).
 */
export async function createCommit(noteId, snapshot, opts = {}) {
  const client = getApiClient(opts.baseUrl ? { baseUrl: opts.baseUrl } : undefined);

  const deviceId = await getSyncDeviceId();
  const ts = Date.now();
  const clock = ts;

  const updateBytes = new TextEncoder().encode(JSON.stringify(snapshot));

  // Shared notes use the per-note key so collaborators can decrypt and the
  // snapshot survives items-key rotation; personal notes fall back to items key.
  let encrypted;
  const noteKeyHex = await resolveCommitKey(noteId);
  if (noteKeyHex) {
    const { importCollabKey, encryptUpdate } = await import(
      '@/utils/crypto/collab.js'
    );
    const key = await importCollabKey(noteKeyHex);
    const sealed = await encryptUpdate(key, updateBytes, noteId);
    encrypted = JSON.stringify({
      v: NOTE_KEY_ENVELOPE_VERSION,
      k: 'note',
      noteId,
      device: deviceId,
      ts,
      data: bufToBase64(sealed),
    });
  } else {
    const { encryptJSON } = await import('@/utils/sync/crypto.js');
    encrypted = await encryptJSON({ update: updateBytes, device: deviceId, noteId, ts }, noteId);
  }

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
