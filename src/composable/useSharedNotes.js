import { ref } from 'vue';
import { listSharedWithMe } from '@/lib/api/collaboration';
import { logger } from '@/utils/logger';
import { applySharedNoteAccess, syncSharedNote } from '@/utils/sync/shared-notes';
import { expectSharedSyncNote, registerSharedSyncKey } from '@/utils/sync/shared-keys';

// Notes this account was invited to individually, across every workspace. The
// server list is authoritative and is written onto the notes themselves as
// `access`; the durable engine routes each note to its owning workspace from
// that same field.
const shared = ref([]);
const loading = ref(false);
const error = ref('');
let fetchController = null;
let fetchInFlight = null;

async function stores() {
  const [{ useAccountStore }, { useNoteStore }] = await Promise.all([
    import('@/store/account'),
    import('@/store/note'),
  ]);
  return { accountStore: useAccountStore(), noteStore: useNoteStore() };
}

async function materializeSharedNotes() {
  const { noteStore } = await stores();
  for (const row of shared.value) {
    if (!row?.noteId) continue;
    if (noteStore.notes.some((n) => n.id === row.noteId)) continue;
    try {
      await noteStore.add({ id: row.noteId, title: row.title || '' });
    } catch (err) {
      logger.warn('[shared-notes] stub materialise failed:', err?.message || err);
    }
  }
}

async function recoverSharedNoteKeys() {
  if (!shared.value.length) return;
  const { useNoteSharing } = await import('@/composable/useNoteSharing');
  const sharing = useNoteSharing();
  for (const row of shared.value) {
    if (!row?.noteId) continue;
    try {
      // Mark expected before any key is known, so a racing push cannot seal it
      // with the caller's items key.
      await expectSharedSyncNote(row.noteId, true);
      const keyHex = await sharing.ensureNoteKey(row.noteId, { backgroundRetry: true });
      if (keyHex) await registerSharedSyncKey(row.noteId, keyHex);
    } catch (err) {
      // Key recovery can reject (e.g. provisioning); the next fetch retries.
      logger.warn('[shared-notes] key recovery failed:', err?.message || err);
    }
  }
}

async function syncSharedNotes() {
  const { accountStore } = await stores();
  const serverUrl = accountStore.serverUrl || '';
  const token = accountStore.token || '';
  await Promise.all(
    shared.value
      .filter((row) => row?.noteId && row.workspaceId)
      .map((row) => syncSharedNote(row.noteId, { serverUrl, token }))
  );
}

async function fetchSharedNotes({ force = false } = {}) {
  if (fetchInFlight && !force) return fetchInFlight;
  const { accountStore } = await stores();
  if (!accountStore.isAuthenticated) {
    shared.value = [];
    await applySharedNoteAccess([]);
    return [];
  }
  fetchController?.abort();
  fetchController = new AbortController();
  loading.value = true;
  error.value = '';
  fetchInFlight = (async () => {
    try {
      const rows = await listSharedWithMe({
        baseUrl: accountStore.serverUrl,
        signal: fetchController.signal,
      });
      shared.value = rows;
      // Persist the grant on the notes themselves and mirror it into the Rust
      // session before any content can be pushed.
      await materializeSharedNotes();
      await applySharedNoteAccess(rows);
      await recoverSharedNoteKeys();
      await syncSharedNotes();
      return rows;
    } catch (err) {
      if (err?.name === 'AbortError') return shared.value;
      error.value = err?.message || String(err);
      logger.warn('[shared-notes] fetch failed:', error.value);
      return shared.value;
    } finally {
      loading.value = false;
      fetchInFlight = null;
    }
  })();
  return fetchInFlight;
}

export function useSharedNotes() {
  return {
    shared,
    sharedNotes: shared,
    loading,
    error,
    fetchSharedNotes,
    refreshSharedNotes: () => fetchSharedNotes({ force: true }),
  };
}
