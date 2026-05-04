import { debounce } from '@/utils/helper';

const PERSIST_DELAY_MS = 300;

/**
 * Composable that manages debounced note persistence.
 *
 * Wraps Pinia's persist flow with a single-schedule-at-a-time queue so that
 * rapid edits (typing, formatting) coalesce into one storage write.
 */
export function useNotePersistence({
  noteStore,
  labelStore,
  appEncryptedLocked,
}) {
  let pendingPersistTimer = null;
  let pendingPersistNoteId = null;
  let pendingPersistPromise = null;
  let resolvePendingPersist = null;
  let rejectPendingPersist = null;

  function clearPendingPersistState() {
    pendingPersistTimer = null;
    pendingPersistNoteId = null;
    pendingPersistPromise = null;
    resolvePendingPersist = null;
    rejectPendingPersist = null;
  }

  function schedulePersist(noteId) {
    if (!noteId || !noteStore.getById(noteId)) {
      return Promise.resolve();
    }

    pendingPersistNoteId = noteId;
    clearTimeout(pendingPersistTimer);

    if (!pendingPersistPromise) {
      pendingPersistPromise = new Promise((resolve, reject) => {
        resolvePendingPersist = resolve;
        rejectPendingPersist = reject;
      });
    }

    pendingPersistTimer = setTimeout(async () => {
      const targetNoteId = pendingPersistNoteId;
      try {
        if (targetNoteId && noteStore.getById(targetNoteId)) {
          await noteStore.persist(targetNoteId);
        }
        resolvePendingPersist?.();
      } catch (error) {
        rejectPendingPersist?.(error);
      } finally {
        clearPendingPersistState();
      }
    }, PERSIST_DELAY_MS);

    return pendingPersistPromise;
  }

  async function flushScheduledPersist(noteId = pendingPersistNoteId) {
    if (!pendingPersistTimer) {
      if (noteId && noteStore.getById(noteId)) {
        await noteStore.persist(noteId);
      }
      return;
    }

    clearTimeout(pendingPersistTimer);

    try {
      if (noteId && noteStore.getById(noteId)) {
        await noteStore.persist(noteId);
      }
      resolvePendingPersist?.();
    } catch (error) {
      rejectPendingPersist?.(error);
      throw error;
    } finally {
      clearPendingPersistState();
    }
  }

  function buildCurrentNotePatch(editor, titleDiv) {
    const labels = new Set();
    const labelEls =
      editor?.options?.element?.querySelectorAll('[data-mention]') ?? [];

    Array.from(labelEls).forEach((el) => {
      const labelId = el.dataset.id;
      if (labelStore.data.includes(labelId)) labels.add(labelId);
    });

    const currentContent = editor?.getJSON();
    const currentTitle = titleDiv?.innerText ?? '';
    const currentCursorPosition = editor?.state?.selection?.to;

    return {
      labels: [...labels],
      ...(currentContent ? { content: currentContent } : {}),
      ...(currentTitle !== undefined ? { title: currentTitle } : {}),
      ...(Number.isFinite(currentCursorPosition)
        ? { lastCursorPosition: currentCursorPosition }
        : {}),
      updatedAt: Date.now(),
    };
  }

  function persistCurrentNote(editor, titleDiv, noteId, { wait = true } = {}) {
    if (appEncryptedLocked.value) return;
    if (!noteId || !noteStore.getById(noteId)) return;

    noteStore.patchLocal(noteId, buildCurrentNotePatch(editor, titleDiv));
    const persistPromise = flushScheduledPersist(noteId);

    if (!wait) {
      persistPromise.catch((error) => {
        console.error('Error persisting note during navigation:', error);
      });
      return;
    }

    return persistPromise;
  }

  function updateNote(noteId, data) {
    if (appEncryptedLocked.value) return Promise.resolve();
    if (!noteId || !noteStore.getById(noteId)) return Promise.resolve();

    noteStore.patchLocal(noteId, {
      ...data,
      updatedAt: Date.now(),
    });
    return schedulePersist(noteId);
  }

  return {
    schedulePersist,
    flushScheduledPersist,
    persistCurrentNote,
    updateNote,
  };
}
