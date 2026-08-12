import * as Y from 'yjs';
import { ref, shallowRef, onUnmounted } from 'vue';
import {
  appendUpdate,
  getUpdates,
  getSnapshot,
  compactUpdates,
} from '@/lib/native/yjs.js';
import { getCommitsDir } from '@/utils/sync/sync-repository.js';
import { queueSyncWrite } from '@/utils/sync/pending-writes.js';
import {
  getDeviceId,
  applyUpdatesToDoc,
  toUint8Array,
  ensureSchema,
} from '@/utils/yjs-helpers.js';
import { getHocuspocusSync, setRoomKey } from '@/lib/sync/hocuspocus-sync.js';
import { useNoteSharing } from './useNoteSharing.js';
import { useWorkspaceStore } from '@/store/workspace';
import { speed } from '@/utils/speed.js';

export { registerActiveDoc, applyRemote } from '@/lib/yjs/shared.js';
import { registerActiveDoc, unregisterActiveDoc } from '@/lib/yjs/shared.js';

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
  const t = speed('yjs_load_snapshot');
  try {
    const snapshot = await getSnapshot(noteId);
    if (snapshot && snapshot.length > 0) {
      Y.applyUpdate(newDoc, toUint8Array(snapshot));
      t?.end();
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
  t?.end();
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
    const commitsDir = await getCommitsDir();
    if (commitsDir) {
      queueSyncWrite(commitsDir, noteId, update);
    }
  } catch {
    //
  }
}

const FLUSH_DELAY_MS = 300;

// `note_content` grows one row per flush and used to only be compacted on note
// switch / unmount — so a long editing session (or a crash before switching)
// left an unbounded update history and forced a full CRDT replay on the next
// open. Compact periodically in the flush path so history stays bounded.
const COMPACT_INTERVAL_MS = 5 * 60 * 1000;
const COMPACT_UPDATE_THRESHOLD = 100;

// Composable that manages Yjs documents across note switches on the page.
export function useNoteYjs() {
  const doc = shallowRef(null);
  const ready = ref(false);
  let currentNoteId = null;
  let currentDoc = null;

  // Debounced Yjs update persistence
  let pendingUpdates = [];
  let flushTimer = null;
  let lastCompactAt = Date.now();
  let updatesSinceCompact = 0;

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
    updatesSinceCompact += updates.length;
    const merged = Y.mergeUpdates(updates);
    await persistUpdate(currentNoteId, merged);

    // Fold the accumulated update history into a single snapshot row once the
    // session has been open long enough / appended enough rows. Non-blocking
    // failure: compaction retries on the next due flush or the note switch.
    const due =
      Date.now() - lastCompactAt > COMPACT_INTERVAL_MS ||
      updatesSinceCompact >= COMPACT_UPDATE_THRESHOLD;
    if (due && currentDoc) {
      try {
        const snapshot = Y.encodeStateAsUpdate(currentDoc);
        if (snapshot.byteLength > 0) {
          await compactUpdates(currentNoteId, snapshot);
        }
        lastCompactAt = Date.now();
        updatesSinceCompact = 0;
      } catch (err) {
        console.warn('[yjs] periodic compact failed, retrying later:', err);
      }
    }
  }

  async function load(noteId, initialContent, initialTitle) {
    const t = speed('yjs_load_note');
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
          // Do not block the switch on the old note's compact. The snapshot is
          // captured before destroy; yjs_compact now runs off the main thread
          // in Rust, so fire it and load the new note immediately.
          compactUpdates(currentNoteId, snapshot).catch(() => {
            // non-critical
          });
        }
      } catch {
        // non-critical
      }
      unregisterActiveDoc(currentNoteId);
      getHocuspocusSync().leaveNoteRoom(currentNoteId);
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

    // Seed title if the fragment is empty (first load from store)
    const titleFrag = newDoc.getXmlFragment('title');
    if (titleFrag.length === 0 && initialTitle) {
      try {
        newDoc.transact(() => {
          const text = new Y.XmlText();
          text.insert(0, initialTitle);
          titleFrag.push([text]);
        }, 'load');
      } catch (e) {
        console.error('[yjs] title seeding failed:', e);
      }
    }

    newDoc.on('update', (update, origin) => {
      if (origin === 'load' || origin === 'sync') return;
      pendingUpdates.push(update);
      scheduleFlush();
    });

    const hocuspocus = getHocuspocusSync();
    try {
      const workspaceStore = useWorkspaceStore();
      const sharing = useNoteSharing();
      const noteKeyHex = await sharing.ensureNoteKey(noteId);
      if (noteKeyHex && workspaceStore.activeId) {
        const roomName = `workspace:${workspaceStore.activeId}:note:${noteId}`;
        await setRoomKey(roomName, noteKeyHex);
      }
    } catch (err) {
      console.warn('[yjs] note-key provisioning skipped:', err);
    }
    hocuspocus.joinNoteRoom(noteId, newDoc);

    currentDoc = newDoc;
    registerActiveDoc(noteId, newDoc);
    doc.value = newDoc;
    ready.value = true;
    t?.end();
  }

  function getTitle() {
    if (!currentDoc) return '';
    const titleFrag = currentDoc.getXmlFragment('title');
    return titleFrag.toJSON() || '';
  }

  function setTitle(title) {
    if (!currentDoc) return;
    const titleFrag = currentDoc.getXmlFragment('title');
    currentDoc.transact(() => {
      titleFrag.delete(0, titleFrag.length);
      if (title) {
        const text = new Y.XmlText();
        text.insert(0, title);
        titleFrag.push([text]);
      }
    });
  }

  function observeTitle(callback) {
    if (!currentDoc) return () => {};
    const titleFrag = currentDoc.getXmlFragment('title');
    const handler = () => {
      callback(titleFrag.toJSON() || '');
    };
    titleFrag.observe(handler);
    return () => titleFrag.unobserve(handler);
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
          compactUpdates(currentNoteId, snapshot).catch(() => {
            // non-critical
          });
        }
      } catch {
        // non-critical
      }
      unregisterActiveDoc(currentNoteId);
      getHocuspocusSync().leaveNoteRoom(currentNoteId);
      currentDoc.destroy();
    }
  });

  return { doc, ready, load, getTitle, setTitle, observeTitle };
}
