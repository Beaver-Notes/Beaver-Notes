import * as Y from 'yjs';
import { ref, shallowRef, onUnmounted } from 'vue';
import {
  appendUpdate,
  getUpdates,
  getSnapshot,
  compactUpdates,
} from '@/lib/native/yjs.js';
import { ensureCommitsDir } from '@/utils/sync/sync-repository.js';
import { getSyncPath } from '@/utils/sync/path.js';
import { getSettingSync } from '@/composable/settings';
import { queueSyncWrite } from '@/utils/sync/pending-writes.js';
import {
  getDeviceId,
  applyUpdatesToDoc,
  toUint8Array,
  ensureSchema,
} from '@/utils/yjs-helpers.js';

const MAX_WRITE_RETRIES = 3;
const WRITE_RETRY_DELAY_MS = 200;

async function retryWrite(fn, label) {
  for (let attempt = 1; attempt <= MAX_WRITE_RETRIES; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      if (attempt === MAX_WRITE_RETRIES) {
        console.error(`[yjs] ${label} failed after ${MAX_WRITE_RETRIES} attempts:`, err);
        throw err;
      }
      console.warn(`[yjs] ${label} attempt ${attempt} failed, retrying...`, err);
      await new Promise((r) => setTimeout(r, WRITE_RETRY_DELAY_MS));
    }
  }
}

const activeDocs = new Map();

export function registerActiveDoc(noteId, doc) {
  activeDocs.set(noteId, doc);
}

export function applyRemote(noteId, update) {
  const target = activeDocs.get(noteId);
  if (!target) return false;
  target.transact(() => {
    Y.applyUpdate(target, update);
  }, 'sync');
  return true;
}

 // Convert TipTap JSON content to Yjs using the editor's own schema.

async function seedFromTipJson(ydoc, contentJson) {
  const { prosemirrorJSONToYDoc } = await import('@tiptap/y-tiptap');
  const schema = await ensureSchema();
  const tempYdoc = prosemirrorJSONToYDoc(schema, contentJson, 'content');
  const update = Y.encodeStateAsUpdate(tempYdoc);
  Y.applyUpdate(ydoc, update);
}

  // Load Yjs state into a doc: try snapshot first (O(1)), fall back to
  // replaying individual updates for backwards compatibility.

async function loadStateIntoDoc(newDoc, noteId) {
  try {
    const snapshot = await getSnapshot(noteId);
    if (snapshot && snapshot.length > 0) {
      Y.applyUpdate(newDoc, toUint8Array(snapshot));
      return;
    }
  } catch (err) {
    console.error(`[yjs] Failed to load snapshot for ${noteId}:`, err);
  }

  try {
    const updates = await getUpdates(noteId);
    applyUpdatesToDoc(newDoc, updates);
  } catch (err) {
    console.error(`[yjs] Failed to load updates for ${noteId}:`, err);
  }
}

  // Persist a Yjs update to SQLite and optionally queue it for the sync folder.
async function persistUpdate(noteId, update) {
  if (!noteId || !update || update.byteLength === 0) return;
  try {
    await retryWrite(
      () => appendUpdate(noteId, update, getDeviceId()),
      `SQLite appendUpdate for ${noteId}`
    );
  } catch {
    //
  }
  try {
    if (getSettingSync('autoSync')) {
      const syncPath = await getSyncPath();
      if (syncPath) {
        const commitsDir = await ensureCommitsDir(syncPath);
        queueSyncWrite(commitsDir, noteId, update);
      }
    }
  } catch {
    //
  }
}

const FLUSH_DELAY_MS = 300;


// Composable that manages Yjs documents across note switches on the page.
export function useNoteYjs() {
  const doc = shallowRef(null);
  const ready = ref(false);
  let currentNoteId = null;
  let currentDoc = null;

  // Debounced Yjs update persistence
  let pendingUpdates = [];
  let flushTimer = null;

  function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushPendingUpdates();
    }, FLUSH_DELAY_MS);
  }

  async function flushPendingUpdates() {
    if (pendingUpdates.length === 0) return;
    const updates = pendingUpdates.splice(0);
    const merged = Y.mergeUpdates(updates);
    await persistUpdate(currentNoteId, merged);
  }

  async function load(noteId, initialContent) {
    // Flush any pending updates for the *previous* note before switching.
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await flushPendingUpdates();

    if (currentDoc && currentNoteId) {
      try {
        const snapshot = Y.encodeStateAsUpdate(currentDoc);
        if (snapshot.byteLength > 0) {
          await compactUpdates(currentNoteId, snapshot);
        }
      } catch {
        // non-critical
      }
      activeDocs.delete(currentNoteId);
      currentDoc.destroy();
    }

    currentNoteId = noteId;
    const newDoc = new Y.Doc();

    await loadStateIntoDoc(newDoc, noteId);

    // If the Y.Doc is still empty after replay, seed from the store content.
    // Handles fresh notes and notes with stale/corrupted snapshots.
    const frag = newDoc.getXmlFragment('content');
    if (frag.length === 0 && initialContent) {
      try {
        await seedFromTipJson(newDoc, initialContent);
        const snapshot = Y.encodeStateAsUpdate(newDoc);
        await compactUpdates(noteId, snapshot);
      } catch (e) {
        console.error('[yjs] seeding also failed:', e);
      }
    }

    newDoc.on('update', (update, origin) => {
      if (origin === 'load' || origin === 'sync') return;
      pendingUpdates.push(update);
      scheduleFlush();
    });

    currentDoc = newDoc;
    activeDocs.set(noteId, newDoc);
    doc.value = newDoc;
    ready.value = true;
  }

  onUnmounted(async () => {
    // Flush buffered updates before compacting.
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await flushPendingUpdates();

    if (currentDoc && currentNoteId) {
      try {
        const snapshot = Y.encodeStateAsUpdate(currentDoc);
        if (snapshot.byteLength > 0) {
          await compactUpdates(currentNoteId, snapshot);
        }
      } catch {
        // non-critical
      }
      activeDocs.delete(currentNoteId);
      currentDoc.destroy();
    }
  });

  return { doc, ready, load };
}
