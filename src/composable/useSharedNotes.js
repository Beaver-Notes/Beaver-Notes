import { ref } from 'vue';
import { listSharedWithMe } from '@/lib/api/collaboration';
import { logger } from '@/utils/logger';
import { isSharedNote, sharedNoteRole, applySharedNoteAccess, syncSharedNote } from '@/utils/sync/shared-notes';
import { expectSharedSyncNote } from '@/utils/sync/shared-keys';
import { debounce } from '@/utils/helpers';

// Notes this account was invited to individually, across every workspace. The
// server list is authoritative and is written onto the notes themselves as
// `access`; the durable engine routes each note to its owning workspace from
// that same field.
const shared = ref([]);
const loading = ref(false);
const error = ref('');
let fetchController = null;
let fetchInFlight = null;
const PUSH_DEBOUNCE_MS = 1000;

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
  if (!shared.value.length) return [];
  const { useNoteSharing } = await import('@/composable/useNoteSharing');
  const sharing = useNoteSharing();
  const resolved = [];
  for (const row of shared.value) {
    if (!row?.noteId) continue;
    try {
      // Mark expected before any key is known, so a racing push cannot seal it
      // with the caller's items key.
      await expectSharedSyncNote(row.noteId, true);
      // First open must await foreground recovery: backgroundRetry returns
      // before the envelope lands, so the fetch-time pull cannot decrypt and
      // the note renders empty until a reopen. The one-shot wait below covers
      // starter/pro/free counterparts; a late arrival still lands via the
      // page's onKeyResolved refresh.
      const keyHex = await sharing.ensureNoteKey(row.noteId);
      if (keyHex) {
        // Registration already happened inside rememberAndProvision (with
        // previous keys for post-rotation history); re-registering bare here
        // would clobber that history, so treat it as resolved and move on.
        resolved.push(row.noteId);
      }
    } catch (err) {
      // Key recovery can reject (e.g. provisioning); the next fetch retries.
      logger.warn('[shared-notes] key recovery failed:', err?.message || err);
    }
  }
  return resolved;
}

async function syncSharedNotes(noteIds) {
  const { accountStore } = await stores();
  const serverUrl = accountStore.serverUrl || '';
  const token = accountStore.token || '';
  const only = noteIds?.length ? new Set(noteIds) : null;
  await Promise.all(
    shared.value
      .filter((row) => row?.noteId && row.workspaceId && (!only || only.has(row.noteId)))
      .map((row) => syncSharedNote(row.noteId, { serverUrl, token }))
  );
}

async function pushSharedNote(noteId) {
  // Viewers stay read-only: their key unwraps for rendering, but nothing they
  // type may leave the device.
  if (isSharedNote(noteId) && sharedNoteRole(noteId) === 'viewer') return;
  try {
    const { accountStore } = await stores();
    await syncSharedNote(noteId, {
      serverUrl: accountStore.serverUrl || '',
      token: accountStore.token || '',
    });
  } catch (err) {
    // A push that does not land is a sync condition, not a failed save.
    logger.warn('[shared-notes] note push failed:', err?.message || err);
  }
}

const scheduledPushes = new Map();

/**
 * Queue a note-scoped push for a shared note. The Rust workspace push skips
 * notes this account only collaborates on, and fetchSharedNotes runs once, so
 * without this every edit after that fetch would stay on this device.
 */
export function scheduleSharedNotePush(noteId) {
  if (!noteId || !isSharedNote(noteId)) return;
  if (sharedNoteRole(noteId) === 'viewer') return;
  let push = scheduledPushes.get(noteId);
  if (!push) {
    push = debounce(() => {
      scheduledPushes.delete(noteId);
      void pushSharedNote(noteId);
    }, PUSH_DEBOUNCE_MS);
    scheduledPushes.set(noteId, push);
  }
  void push();
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
      // Mark every shared note as expected BEFORE writing any local stub. The
      // stub schedules a debounced push, and a push that wins the race would
      // seal the note under our own account items key (v5): no other account
      // can ever read that row, and it holds their checkpoint forever.
      for (const row of rows ?? []) {
        if (row?.noteId) await expectSharedSyncNote(row.noteId, true).catch(() => {});
      }
      // Persist the grant on the notes themselves and mirror it into the Rust
      // session before any content can be pushed.
      await materializeSharedNotes();
      await applySharedNoteAccess(rows, { selfId: accountStore.profile?.id || null });
      await syncSharedNotes();
      // Keys that resolve only now missed the decrypt window of that pull, so
      // re-pull them keyed instead of leaving the note empty until reopen.
      const resolved = await recoverSharedNoteKeys();
      if (resolved.length) await syncSharedNotes(resolved);
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
