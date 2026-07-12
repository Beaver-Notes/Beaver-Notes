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
import { writeYjsUpdate } from '@/utils/sync/sync-yjs.js';
import { encryptJSON } from '@/utils/sync/crypto.js';
import {
  getDeviceId,
  applyUpdatesToDoc,
  toUint8Array,
  ensureSchema,
} from '@/utils/yjs-helpers.js';

const activeDocs = new Map();

const snapshotCache = new Map();
const inflightSnapshots = new Map();

export function preloadSnapshot(noteId) {
  if (!noteId || snapshotCache.has(noteId) || inflightSnapshots.has(noteId)) {
    return inflightSnapshots.get(noteId) || Promise.resolve();
  }
  const p = getSnapshot(noteId)
    .then((snap) => {
      if (snap && snap.length > 0) {
        snapshotCache.set(noteId, snap);
      }
    })
    .catch(() => {})
    .finally(() => {
      inflightSnapshots.delete(noteId);
    });
  inflightSnapshots.set(noteId, p);
  return p;
}

function consumeSnapshot(noteId) {
  if (snapshotCache.has(noteId)) {
    const snap = snapshotCache.get(noteId);
    snapshotCache.delete(noteId);
    return snap;
  }
  return null;
}

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

/**
 * Convert TipTap JSON content to Yjs using the editor's own schema.
 */
async function seedFromTipJson(ydoc, contentJson) {
  const { prosemirrorJSONToYDoc } = await import('@tiptap/y-tiptap');
  const schema = await ensureSchema();
  const tempYdoc = prosemirrorJSONToYDoc(schema, contentJson, 'content');
  const update = Y.encodeStateAsUpdate(tempYdoc);
  Y.applyUpdate(ydoc, update);
}

/**
 * Load Yjs state into a doc: try snapshot first (O(1)), fall back to
 * replaying individual updates for backwards compatibility.
 */
async function loadStateIntoDoc(newDoc, noteId) {
  try {
    const cached = consumeSnapshot(noteId);
    let snapshot;
    if (cached) {
      console.log(`[perf] ${noteId} snapshot cache hit`);
      snapshot = cached;
    } else {
      console.time(`[perf] ${noteId} getSnapshot`);
      snapshot = await getSnapshot(noteId);
      console.timeEnd(`[perf] ${noteId} getSnapshot`);
    }
    if (snapshot && snapshot.length > 0) {
      console.time(`[perf] ${noteId} applySnapshot`);
      Y.applyUpdate(newDoc, toUint8Array(snapshot));
      console.timeEnd(`[perf] ${noteId} applySnapshot`);
      console.log(
        `[perf] ${noteId} loaded from snapshot (${snapshot.length} bytes)`
      );
      return;
    }
  } catch (err) {
    console.error(`[yjs] Failed to load snapshot for ${noteId}:`, err);
  }

  try {
    console.time(`[perf] ${noteId} getUpdates`);
    const updates = await getUpdates(noteId);
    console.timeEnd(`[perf] ${noteId} getUpdates`);
    const count = updates?.length || 0;
    console.log(`[perf] ${noteId} replaying ${count} updates`);
    console.time(`[perf] ${noteId} applyUpdates`);
    applyUpdatesToDoc(newDoc, updates);
    console.timeEnd(`[perf] ${noteId} applyUpdates`);
  } catch (err) {
    console.error(`[yjs] Failed to load updates for ${noteId}:`, err);
  }
}

/**
 * Persist a Yjs update to SQLite and optionally to the sync folder.
 */
async function persistUpdate(noteId, update) {
  if (!noteId || !update || update.byteLength === 0) return;
  try {
    await appendUpdate(noteId, update, getDeviceId());
  } catch {
    // SQLite write is best-effort
  }
  try {
    if (getSettingSync('autoSync')) {
      const syncPath = await getSyncPath();
      if (syncPath) {
        const commitsDir = await ensureCommitsDir(syncPath);
        await writeYjsUpdate(commitsDir, noteId, update, encryptJSON);
      }
    }
  } catch {
    // sync folder write is best-effort
  }
}

/**
 * Composable that manages Yjs documents across note switches on the page.
 *
 * - `load(noteId)` — loads/creates a Y.Doc for the given note
 * - `doc` — ref to the current Y.Doc
 * - `ready` — becomes true after first load
 */
export function useNoteYjs() {
  const doc = shallowRef(null);
  const ready = ref(false);
  let currentNoteId = null;
  let currentDoc = null;

  async function load(noteId, initialContent) {
    const label = `[perf] load ${noteId}`;
    console.time(label);

    // Fire-and-forget: compact previous doc in background
    if (currentDoc && currentNoteId) {
      const prevDoc = currentDoc;
      const prevId = currentNoteId;
      try {
        const snapshot = Y.encodeStateAsUpdate(prevDoc);
        if (snapshot.byteLength > 0) {
          compactUpdates(prevId, snapshot).catch(() => {});
        }
      } catch {
        // non-critical
      }
      activeDocs.delete(prevId);
      prevDoc.destroy();
    }

    currentNoteId = noteId;
    const newDoc = new Y.Doc();

    await loadStateIntoDoc(newDoc, noteId);

    // If the Y.Doc is still empty after replay, seed from the store content.
    // Handles fresh notes and notes with stale/corrupted snapshots.
    const frag = newDoc.getXmlFragment('content');
    if (frag.length === 0 && initialContent) {
      console.time(`${label} seed`);
      try {
        await seedFromTipJson(newDoc, initialContent);
        const snapshot = Y.encodeStateAsUpdate(newDoc);
        await compactUpdates(noteId, snapshot);
      } catch (e) {
        console.error('[yjs] seeding also failed:', e);
      }
      console.timeEnd(`${label} seed`);
    }

    newDoc.on('update', (update, origin) => {
      if (origin === 'load' || origin === 'sync') return;
      persistUpdate(currentNoteId, update);
    });

    currentDoc = newDoc;
    activeDocs.set(noteId, newDoc);
    doc.value = newDoc;
    ready.value = true;
    console.timeEnd(label);
  }

  onUnmounted(async () => {
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
