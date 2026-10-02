import { ref } from 'vue';
import {
  appendActivity,
  listActivity,
  clearActivity,
} from '@/lib/native/activity';
import {
  listActivity as listSharedActivity,
  createActivity as createSharedActivity,
} from '@/lib/api/activity';
import { useNoteSharing } from '@/composable/useNoteSharing';
import { useCollaboratorStore } from '@/store/collaborator';
import { importCollabKey } from '@/utils/crypto/collab';
import { encryptComment, decryptComment } from '@/utils/crypto/comment-crypto';
import { revertReviewChange } from '@/lib/tiptap/exts/version-preview';

// One typing burst is already coalesced to a single entry by the recorder, so
// the upload debounce only batches a few rapid bursts into one flush.
export const SHARED_ACTIVITY_UPLOAD_DEBOUNCE_MS = 300;
// Failed uploads keep the local entry and retry later (sync bias: never drop,
// never unhandled). Single timer, deduped.
export const SHARED_ACTIVITY_RETRY_MS = 5000;

const FALLBACK_ACTOR_LABEL = 'someone';

/**
 * Per-note durable activity log (plan Phase 1), layered with shared-note sync
 * (plan Phase 2).
 *
 * Entries recorded in this session keep their ProseMirror baseline/target in
 * memory so Undo can re-apply the exact inverse; entries loaded from storage
 * have no baseline, so Undo is disabled for them rather than guessing.
 *
 * A note with a shared note key also encrypts each entry with that key (same
 * envelope as comments) and merges the note's shared entries back in, deduped by
 * entry id. A local-only note never calls the shared activity API.
 */
export function createActivityLog({
  uploadDebounceMs = SHARED_ACTIVITY_UPLOAD_DEBOUNCE_MS,
  retryMs = SHARED_ACTIVITY_RETRY_MS,
} = {}) {
  const entries = ref([]);
  const loading = ref(false);
  const error = ref(null);
  const noteId = ref('');
  const undone = ref(new Set());
  const undoRecords = new Map();
  let loadedNoteId = null;

  // Shared-note state. The key is resolved once per note; `null` means the note
  // is local-only (no shared activity store) and is never retried this session.
  let keyNoteId = null;
  let keyPromise = null;
  let sharedKeyHex = null;
  let keyResolved = false;

  // Entries awaiting a shared upload, each tagged with its note.
  let pendingUploads = [];
  let uploadTimer = null;
  let retryTimer = null;
  let flushInFlight = false;
  let failureLogged = false;

  function resolveActorLabel(actorId, fallback) {
    if (actorId) {
      try {
        const user = useCollaboratorStore().usernames.find((u) => u.id === actorId);
        if (user?.username || user?.label) return user.username || user.label;
      } catch {
        // No active Pinia (non-component caller): fall through.
      }
    }
    return fallback || FALLBACK_ACTOR_LABEL;
  }

  function ensureSharedKey(id) {
    if (!id) return Promise.resolve(null);
    if (keyNoteId !== id) {
      keyNoteId = id;
      keyPromise = null;
      sharedKeyHex = null;
      keyResolved = false;
    }
    if (keyResolved) return Promise.resolve(sharedKeyHex);
    if (!keyPromise) {
      keyPromise = (async () => {
        try {
          sharedKeyHex = (await useNoteSharing().ensureNoteKey(id)) || null;
        } catch {
          sharedKeyHex = null;
        } finally {
          keyResolved = true;
          keyPromise = null;
        }
        return sharedKeyHex;
      })();
    }
    return keyPromise;
  }

  function mergeEntries(incoming) {
    if (!incoming.length) return;
    const byId = new Map();
    for (const e of entries.value) byId.set(e.id, e);
    // First occurrence wins: the local copy (with its in-session undo baseline)
    // is never overwritten by the server echo of the same entry id.
    for (const e of incoming) {
      if (!byId.has(e.id)) byId.set(e.id, e);
    }
    entries.value = [...byId.values()].sort(
      (a, b) => (Number(b.at) || 0) - (Number(a.at) || 0)
    );
  }

  async function mergeSharedEntries(id) {
    if (!id) return;
    const keyHex = await ensureSharedKey(id);
    if (!keyHex) return;
    const key = await importCollabKey(keyHex);
    const rows = (await listSharedActivity(id)) || [];
    const incoming = [];
    for (const row of rows) {
      if (!row) continue;
      try {
        const payload = JSON.parse(await decryptComment(key, row, id));
        const actorId = payload.actorId ?? row.authorId ?? null;
        const at = Number(payload.at);
        incoming.push({
          id: row.id,
          noteId: id,
          actorId,
          actorLabel: resolveActorLabel(actorId, payload.actorLabel),
          kind: payload.kind || row.kind || 'insert',
          summary: payload.summary || '',
          at: Number.isFinite(at) ? at : Date.parse(row.createdAt) || Date.now(),
          anchorHint: payload.anchorHint ?? null,
        });
      } catch (err) {
        // A single undecryptable entry must not abort the merge.
        console.warn('[activity] failed to decrypt a shared entry:', err?.message);
      }
    }
    mergeEntries(incoming);
  }

  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      return flushUploads();
    }, retryMs);
  }

  async function flushUploads() {
    if (flushInFlight) return;
    if (!pendingUploads.length) return;
    flushInFlight = true;
    const batch = pendingUploads.splice(0);
    const failed = [];
    const keyCache = new Map();
    for (const { note, entry } of batch) {
      try {
        let keyHex = keyCache.get(note);
        if (keyHex === undefined) {
          keyHex = await ensureSharedKey(note);
          keyCache.set(note, keyHex);
        }
        if (!keyHex) continue;
        const key = await importCollabKey(keyHex);
        const payload = JSON.stringify({
          actorId: entry.actorId ?? null,
          actorLabel: entry.actorLabel ?? '',
          kind: entry.kind,
          summary: entry.summary ?? '',
          at: entry.at,
          anchorHint: entry.anchorHint ?? null,
        });
        const { contentEncrypted, contentIv } = await encryptComment(key, payload, note);
        await createSharedActivity(note, {
          id: entry.id,
          contentEncrypted,
          contentIv,
        });
        failureLogged = false;
      } catch (err) {
        failed.push({ note, entry });
        if (!failureLogged) {
          console.warn('[activity] shared upload failed; will retry:', err?.message);
          failureLogged = true;
        }
      }
    }
    flushInFlight = false;
    if (failed.length) {
      pendingUploads.unshift(...failed);
      scheduleRetry();
    }
    if (pendingUploads.length && !uploadTimer && !retryTimer && !failed.length) {
      scheduleUploadFlush();
    }
  }

  function scheduleUploadFlush() {
    if (uploadTimer) return;
    uploadTimer = setTimeout(() => {
      uploadTimer = null;
      return flushUploads();
    }, uploadDebounceMs);
  }

  function queueSharedUpload(entry) {
    if (!entry?.id || !entry.noteId) return;
    pendingUploads.push({ note: entry.noteId, entry });
    scheduleUploadFlush();
  }

  async function load(id) {
    loadedNoteId = id || null;
    noteId.value = id || '';
    loading.value = true;
    error.value = null;
    undoRecords.clear();
    undone.value = new Set();
    try {
      entries.value = (await listActivity(id)) || [];
    } catch (err) {
      error.value = err?.message || 'Failed to load activity';
      entries.value = [];
    }
    try {
      await mergeSharedEntries(id);
    } catch (err) {
      // Shared merge failure must never clear the local entries already shown.
      console.warn('[activity] shared activity merge failed:', err?.message);
    } finally {
      loading.value = false;
    }
  }

  // Recording may start before the panel opens; in that case keep the live
  // session's entries and undo baselines instead of reloading over them, but
  // still pull the shared timeline in.
  async function loadIfNeeded(id) {
    if (loadedNoteId === id) return;
    if (noteId.value === id) {
      loadedNoteId = id;
      try {
        await mergeSharedEntries(id);
      } catch (err) {
        console.warn('[activity] shared activity merge failed:', err?.message);
      }
      return;
    }
    await load(id);
  }

  function record({ entry, baseline, target } = {}) {
    if (!entry) return null;
    if (baseline && target) undoRecords.set(entry.id, { baseline, target });
    if (!noteId.value) noteId.value = entry.noteId || '';
    entries.value = [entry, ...entries.value];
    appendActivity([entry]).catch((err) => {
      console.warn('[activity] append failed:', err?.message);
    });
    queueSharedUpload(entry);
    return entry;
  }

  function canUndo(entry) {
    if (!entry || undone.value.has(entry.id)) return false;
    return undoRecords.has(entry.id);
  }

  function undo(entry, editor) {
    const rec = undoRecords.get(entry?.id);
    if (!rec) return false;
    const ok = revertReviewChange(editor, rec.baseline, rec.target);
    if (ok) {
      undoRecords.delete(entry.id);
      undone.value = new Set([...undone.value, entry.id]);
    }
    return ok;
  }

  async function clear() {
    const id = noteId.value;
    if (!id) return;
    await clearActivity(id);
    entries.value = [];
    undoRecords.clear();
    undone.value = new Set();
    // Never re-upload entries the user just cleared.
    pendingUploads = pendingUploads.filter((item) => item.note !== id);
  }

  return {
    entries,
    loading,
    error,
    noteId,
    load,
    loadIfNeeded,
    record,
    canUndo,
    undo,
    clear,
  };
}

// Singleton: the note page records while the history panel renders, and both
// must share one list.
let singleton = null;
export function useActivityLog() {
  return (singleton ??= createActivityLog());
}
