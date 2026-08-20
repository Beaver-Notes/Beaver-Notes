import {
  listKeyDistributionRequests,
  getCollaborationKey,
  storeRecipients,
  deleteKeyDistributionRequest,
} from '@/lib/api/collaboration';
import { recoverNoteKeyFromEnvelopes, wrapNoteKeyForRecipient } from '@/utils/crypto/note-key';
import { loadOrCreateIdentity } from '@/utils/crypto/identity';
import { accountStore } from '@/store/account';

// Resolve a target device's public key. The brief lets callers pass either a
// `resolvePublicKey(noteId, targetDeviceId)` function or a plain
// `targetPublicKeys` map used as a fallback resolver (keyed by deviceId).
export async function fulfillPendingRequests({
  identity,
  resolvePublicKey,
  targetPublicKeys,
  baseUrl,
  signal,
} = {}) {
  if (!accountStore.isAuthenticated) return;

  const id = identity ?? (await loadOrCreateIdentity());
  const resolver =
    resolvePublicKey ?? ((_noteId, deviceId) => targetPublicKeys?.[deviceId] ?? null);

  const { requests } = await listKeyDistributionRequests({ baseUrl, signal });
  for (const req of requests || []) {
    try {
      const raw = await getCollaborationKey(req.noteId, { baseUrl, signal });
      const noteKeyHex = await recoverNoteKeyFromEnvelopes(raw?.wrappedKeys, id, req.noteId);
      if (!noteKeyHex) continue; // we don't hold this note's key; skip

      const pub = resolver(req.noteId, req.targetDeviceId);
      if (!pub) continue; // can't resolve target device's public key

      const wrappedKey = await wrapNoteKeyForRecipient(pub, noteKeyHex);
      await storeRecipients(
        req.noteId,
        [{ userId: req.userId, deviceId: req.targetDeviceId, wrappedKey }],
        { baseUrl }
      );
      await deleteKeyDistributionRequest(req.noteId, req.targetDeviceId, { baseUrl, signal });
    } catch (err) {
      console.warn('[key-distributor] failed for', req.noteId, req.targetDeviceId, err);
    }
  }
}

export function useKeyDistributor() {
  let timer = null;
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const identity = await loadOrCreateIdentity();
      const { fetchCollaboratorPublicKeys } = await import('@/composable/useNoteSharing');
      // resolvePublicKey needs the note's collaborator device keys; fetch lazily per request
      await fulfillPendingRequests({
        identity,
        resolvePublicKey: async (noteId, targetDeviceId) => {
          const list = await fetchCollaboratorPublicKeys(noteId);
          const c = (list?.collaborators || []).find((x) => x.deviceId === targetDeviceId);
          return c?.kemPublicKey || null;
        },
      });
    } catch (err) {
      console.warn('[key-distributor] tick failed:', err);
    } finally {
      running = false;
    }
  }

  function start(intervalMs = 15000) {
    stop();
    timer = setInterval(tick, intervalMs);
    tick();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, tick };
}
