import * as Y from 'yjs';
import { ref, shallowRef, unref, onUnmounted } from 'vue';
import { nanoid } from 'nanoid';
import {
  appendUpdate,
  getUpdates,
  getSnapshot,
  compactUpdates,
} from '@/lib/native/yjs.js';
import { getCommitsDir } from '@/utils/sync/sync-repository.js';
import { queueSyncWrite } from '@/utils/sync/pending-writes.js';
import { getDeviceId, applyUpdatesToDoc, toUint8Array } from '@/lib/yjs/helpers.js';
import { getHocuspocusSync, setRoomKey } from '@/lib/sync/hocuspocus-sync.js';
import { useNoteSharing } from './useNoteSharing.js';
import { useWorkspaceStore } from '@/store/workspace';
import { registerActiveDoc, unregisterActiveDoc } from '@/lib/yjs/shared.js';

// Row docs persist under a `db:` prefixed id so note-oriented FTS indexing and
// backups can skip them. Must stay in sync with src/store/database.ts.
export const ROW_DOC_PREFIX = 'db:';
export const rowDocId = (dbId) => `${ROW_DOC_PREFIX}${dbId}`;

const MAX_WRITE_RETRIES = 3;
const WRITE_RETRY_DELAY_MS = 200;
const FLUSH_DELAY_MS = 300;
// Same bounded-history policy as notes: fold accumulated updates into a
// snapshot once the session has been open long enough / appended enough rows.
const COMPACT_INTERVAL_MS = 5 * 60 * 1000;
const COMPACT_UPDATE_THRESHOLD = 100;

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

// Load Yjs state into a doc: try snapshot first (O(1)), fall back to
// replaying individual updates for backwards compatibility. Mirrors
// useNoteYjs.loadStateIntoDoc including corrupt-snapshot self-repair.
async function loadRowStateIntoDoc(dbId, newDoc) {
  const id = rowDocId(dbId);
  let snapshotWasCorrupt = false;
  try {
    const snapshot = await getSnapshot(id);
    if (snapshot && snapshot.length > 0) {
      const bytes = toUint8Array(snapshot);
      // Validate in an isolated probe doc so garbage bytes never mutate the
      // live document; on failure fall back to replaying updates.
      const probe = new Y.Doc();
      try {
        Y.applyUpdate(probe, bytes);
      } finally {
        probe.destroy();
      }
      Y.applyUpdate(newDoc, bytes, 'load');
      return;
    }
  } catch (err) {
    snapshotWasCorrupt = true;
    console.error(`[yjs] Failed to load snapshot for ${id}:`, err);
  }

  try {
    const updates = await getUpdates(id);
    applyUpdatesToDoc(newDoc, updates);
  } catch (err) {
    console.error(`[yjs] Failed to load updates for ${id}:`, err);
  }

  if (snapshotWasCorrupt && newDoc.store) {
    try {
      const rebuilt = Y.encodeStateAsUpdate(newDoc);
      if (rebuilt.byteLength > 0) {
        await compactUpdates(id, rebuilt);
      }
    } catch (repairErr) {
      console.warn(`[yjs] could not repair snapshot for ${id}:`, repairErr);
    }
  }
}

export async function openRowDoc(dbId) {
  const doc = new Y.Doc();
  await loadRowStateIntoDoc(dbId, doc);
  return { doc, rows: doc.getArray('rows') };
}

export async function persistRowDocSnapshot(dbId, doc) {
  const snapshot = Y.encodeStateAsUpdate(doc);
  if (snapshot.byteLength === 0) return;
  await compactUpdates(rowDocId(dbId), snapshot);
}

// Composable managing one database's row doc (`rows` = Y.Array of
// Y.Map { id, createdAt, updatedAt, cells: Y.Map }). Lifecycle mirrors
// useNoteYjs: debounced merged flush → SQLite + sync folder, periodic
// compact, hocuspocus room join/leave, active-doc registration.
export function useDatabaseYjs(dbId) {
  const rows = shallowRef(null);
  const ready = ref(false);
  const version = ref(0);
  let currentDbId = null;
  let currentDoc = null;

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
    if (pendingUpdates.length === 0 || !currentDoc) return;
    const updates = pendingUpdates.splice(0);
    updatesSinceCompact += updates.length;
    const merged = Y.mergeUpdates(updates);
    await persistUpdate(currentDbId, merged);

    const due =
      Date.now() - lastCompactAt > COMPACT_INTERVAL_MS ||
      updatesSinceCompact >= COMPACT_UPDATE_THRESHOLD;
    if (due && currentDoc) {
      try {
        const snapshot = Y.encodeStateAsUpdate(currentDoc);
        if (snapshot.byteLength > 0) {
          await compactUpdates(rowDocId(currentDbId), snapshot);
        }
        lastCompactAt = Date.now();
        updatesSinceCompact = 0;
      } catch (err) {
        console.warn('[yjs] periodic compact failed, retrying later:', err);
      }
    }
  }

  async function persistUpdate(db, update) {
    if (!db || !update || update.byteLength === 0) return;
    const id = rowDocId(db);
    try {
      await retryWrite(
        () => appendUpdate(id, update, getDeviceId()),
        `SQLite appendUpdate for ${id}`
      );
    } catch {
      //
    }
    try {
      const commitsDir = await getCommitsDir();
      if (commitsDir) {
        queueSyncWrite(commitsDir, id, update);
      }
    } catch {
      //
    }
  }

  async function setup() {
    currentDbId = unref(dbId);
    const newDoc = new Y.Doc();

    await loadRowStateIntoDoc(currentDbId, newDoc);

    newDoc.on('update', (update, origin) => {
      if (origin === 'load' || origin === 'sync' || origin === 'hocuspocus') return;
      pendingUpdates.push(update);
      scheduleFlush();
    });

    const rowsArr = newDoc.getArray('rows');
    rowsArr.observeDeep(() => {
      version.value++;
    });

    try {
      const workspaceStore = useWorkspaceStore();
      const sharing = useNoteSharing();
      const keyHex = await sharing.ensureNoteKey(currentDbId);
      if (keyHex && workspaceStore.activeId) {
        // Same canonical room name joinNoteRoom derives internally; only the
        // key needs the explicit string.
        await setRoomKey(`workspace:${workspaceStore.activeId}:note:${currentDbId}`, keyHex);
      }
    } catch (err) {
      // Offline-first: proceed without a collaboration room.
      console.warn('[yjs] database note-key provisioning skipped:', err);
    }
    currentDoc = newDoc;
    registerActiveDoc(currentDbId, newDoc);

    getHocuspocusSync().joinNoteRoom(currentDbId, newDoc);

    rows.value = rowsArr;
    ready.value = true;
  }

  function findRow(rowId) {
    return rows.value?.toArray().find((m) => m.get('id') === rowId) || null;
  }

  function createRow(cells = {}) {
    if (!rows.value || !currentDoc) return '';
    const row = new Y.Map();
    currentDoc.transact(() => {
      row.set('id', nanoid());
      row.set('createdAt', Date.now());
      row.set('updatedAt', Date.now());
      const cellsMap = new Y.Map();
      for (const [k, v] of Object.entries(cells)) cellsMap.set(k, v);
      row.set('cells', cellsMap);
      rows.value.push([row]);
    });
    return row.get('id');
  }

  function updateCells(rowId, patch) {
    if (!rows.value || !currentDoc) return;
    const row = findRow(rowId);
    if (!row) return;
    currentDoc.transact(() => {
      let cells = row.get('cells');
      if (!cells) {
        cells = new Y.Map();
        row.set('cells', cells);
      }
      for (const [k, v] of Object.entries(patch)) cells.set(k, v);
      row.set('updatedAt', Date.now());
    });
  }

  function deleteRow(rowId) {
    if (!rows.value || !currentDoc) return;
    const idx = rows.value.toArray().findIndex((m) => m.get('id') === rowId);
    if (idx >= 0) currentDoc.transact(() => rows.value.delete(idx, 1));
  }

  function getRow(rowId) {
    const row = findRow(rowId);
    if (!row) return null;
    return {
      id: row.get('id'),
      cells: row.get('cells')?.toJSON() ?? {},
      createdAt: row.get('createdAt'),
      updatedAt: row.get('updatedAt'),
    };
  }

  setup();

  onUnmounted(async () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await flushPendingUpdates();

    if (currentDoc && currentDbId) {
      try {
        const snapshot = Y.encodeStateAsUpdate(currentDoc);
        if (snapshot.byteLength > 0) {
          compactUpdates(rowDocId(currentDbId), snapshot).catch(() => {
            // non-critical
          });
        }
      } catch {
        // non-critical
      }
      unregisterActiveDoc(currentDbId);
      getHocuspocusSync().leaveNoteRoom(currentDbId);
      currentDoc.destroy();
      currentDoc = null;
    }
  });

  return { rows, ready, version, createRow, updateCells, deleteRow, getRow };
}
