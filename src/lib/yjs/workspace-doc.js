/** Workspace Y.Doc for metadata (folders, labels, tombstones, note meta). Content lives per-note. Owns lifecycle and sync. */

import * as Y from 'yjs';
import { appendUpdate, getSnapshot, getUpdates } from '@/lib/native/yjs.js';
import { readDir as readSyncDir } from '@/lib/native/fs';
import { getCommitsDir } from '@/utils/sync/sync-repository.js';
import { writeYjsSnapshot } from '@/utils/sync/sync-yjs.js';
import { encryptJSON } from '@/utils/sync/crypto.js';
import { queueSyncWrite } from '@/utils/sync/pending-writes.js';
import { YJS_UPDATE_EXT } from '@/utils/sync/constants.js';
import { registerActiveDoc } from './shared.js';
import {
  getDeviceId,
  objToYMap,
  toUint8Array,
} from '@/lib/yjs/helpers.js';
import { getWorkspaceDoc, META_DOC_ID, onWorkspaceDocDestroy } from './meta-doc.js';
import { getWsSync, setRoomKey, buildMetaRoomName } from '@/lib/sync/ws-sync';
import { useWorkspaceStore } from '@/store/workspace';
import { getWorkspaceKey, getCachedWorkspaceKey } from '@/lib/api/workspaces';
import { loadOrCreateIdentity } from '@/utils/crypto/identity';
import { unwrapNoteKey } from '@/utils/crypto/note-key';

// Re-export store hydration so consumers keep a single import path
export { writeStoresFromWorkspace, backfillNotePreviews } from './meta-store.js';

const NOTE_META_FIELDS = [
  'id',
  'title',
  'folderId',
  'labels',
  'isArchived',
  'isLocked',
  'isBookmarked',
  'isFullWidth',
  'createdAt',
  'updatedAt',
  'preview',
  'cardPreview',
  'dir',
];

let observerAttached = false;
let persistHandlerAttached = false;
let snapshotWritten = false;

// Reset module-level flags when the doc singleton is destroyed (workspace
// switch, account switch) so observers re-attach on next creation.
onWorkspaceDocDestroy(() => {
  observerAttached = false;
  persistHandlerAttached = false;
  snapshotWritten = false;
});

// Debounced, merged persistence: a burst of meta edits would otherwise issue
// one SQLite IPC + AES encrypt per change. Buffer deltas, merge once
// (Y.mergeUpdates is lossless CRDT state), write once.
const META_FLUSH_DELAY_MS = 300;
let pendingMetaUpdates = [];
let metaFlushTimer = null;

function scheduleMetaFlush() {
  if (metaFlushTimer) clearTimeout(metaFlushTimer);
  metaFlushTimer = setTimeout(() => {
    metaFlushTimer = null;
    flushPendingMetaUpdates();
  }, META_FLUSH_DELAY_MS);
}

export async function flushPendingMetaUpdates() {
  if (pendingMetaUpdates.length === 0) return;
  const updates = pendingMetaUpdates.splice(0);
  const merged = Y.mergeUpdates(updates);
  if (merged.byteLength === 0) return;
  await persistWorkspace(merged);
}

const MAX_WRITE_RETRIES = 3;
const WRITE_RETRY_DELAY_MS = 200;

async function retryWrite(fn, label) {
  for (let attempt = 1; attempt <= MAX_WRITE_RETRIES; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      if (attempt === MAX_WRITE_RETRIES) {
        console.error(`[meta-yjs] ${label} failed after ${MAX_WRITE_RETRIES} attempts:`, err);
        throw err;
      }
      console.warn(`[meta-yjs] ${label} attempt ${attempt} failed, retrying...`, err);
      await new Promise((r) => setTimeout(r, WRITE_RETRY_DELAY_MS));
    }
  }
}

async function persistWorkspace(update) {
  if (!update || update.byteLength === 0) return;
  try {
    await retryWrite(
      () => appendUpdate(META_DOC_ID, update, getDeviceId()),
      `SQLite appendUpdate for meta`
    );
  } catch {
    // Update lost despite retries: documented in retryWrite.
  }
  try {
    const commitsDir = await getCommitsDir();
    if (commitsDir) {

      if (!snapshotWritten) {
        const files = await readSyncDir(commitsDir).catch(() => []);
        const hasWorkspaceFiles = files.some(
          (f) => f.endsWith(YJS_UPDATE_EXT) && f.startsWith('meta')
        );
        if (!hasWorkspaceFiles) {
          const fullState = Y.encodeStateAsUpdate(getWorkspaceDoc());
          await writeYjsSnapshot(commitsDir, META_DOC_ID, fullState, encryptJSON);
        }
        snapshotWritten = true;
      }

      queueSyncWrite(commitsDir, META_DOC_ID, update);
    }
  } catch {
    // Sync folder write failure non-fatal: update already in SQLite.
  }
}


export async function loadWorkspaceDoc() {
  // Flush buffered meta updates BEFORE reading SQLite so freshly seeded
  // state is persisted and can't be lost on reload.
  await flushPendingMetaUpdates();

  const doc = getWorkspaceDoc();

  if (!persistHandlerAttached) {
    doc.on('update', (update, origin) => {
      if (origin === 'load' || origin === 'sync' || origin === 'ws-relay') return;
      pendingMetaUpdates.push(update);
      scheduleMetaFlush();
    });

    // Flush buffered meta updates on pagehide so nothing is lost.
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', flushPendingMetaUpdates);
    }
    persistHandlerAttached = true;
  }

  let snapshotLoaded = false;
  try {
    const snapshot = await getSnapshot(META_DOC_ID);
    if (snapshot && snapshot.length > 0) {
      Y.applyUpdate(doc, toUint8Array(snapshot), 'load');
      snapshotLoaded = true;
    }
  } catch (err) {
    console.error('[meta-yjs] snapshot corrupted: attempting recovery from updates:', err?.message);
  }

  // Recovery: replay individual updates, skip corrupted: snapshot invalid but history may be intact.
  if (!snapshotLoaded) {
    try {
      const updates = await getUpdates(META_DOC_ID);
      if (Array.isArray(updates) && updates.length > 0) {
        let applied = 0;
        for (const upd of updates) {
          try {
            const bytes = upd?.update
              ? toUint8Array(upd.update)
              : upd instanceof Uint8Array
                ? upd
                : null;
            if (bytes && bytes.byteLength > 0) {
              Y.applyUpdate(doc, bytes, 'load');
              applied++;
            }
          } catch {
            // Skip corrupted updates: best-effort recovery.
          }
        }
        if (applied > 0) {
          console.warn(`[meta-yjs] recovered ${applied}/${updates.length} updates from history`);
        } else {
          console.warn('[meta-yjs] all updates corrupted: starting with empty workspace doc');
        }
      }
    } catch (updateErr) {
      console.warn('[meta-yjs] update replay also failed:', updateErr?.message);
    }
  }

  registerActiveDoc(META_DOC_ID, doc);

  const wsSync = getWsSync();
  const workspaceStore = useWorkspaceStore();
  const wsId = workspaceStore.activeId;
  if (wsId) {
    // Supply WORKSPACE key to Hocuspocus meta room before join, else inbound meta corrupts and grid goes blank.
    await ensureMetaRoomKey(wsId).catch((err) => {
      console.warn('[meta-yjs] could not derive workspace meta key:', err?.message || err);
    });
    wsSync.joinMetaRoom(wsId);
  }

  return doc;
}

/** Derive workspace key and register on Hocuspocus meta room. Cache to store wrapped key to API fetch. */
export async function ensureMetaRoomKey(wsId) {
  if (!wsId) return;
  let workspaceKeyHex = getCachedWorkspaceKey(wsId);
  if (workspaceKeyHex) {
    await setRoomKey(buildMetaRoomName(wsId), workspaceKeyHex);
    return;
  }
  const workspaceStore = useWorkspaceStore();
  const ws =
    workspaceStore.activeWorkspace ||
    workspaceStore.workspaces?.find((w) => w.id === wsId);
  let wrappedKey = ws?.wrappedKey ?? null;
  if (!wrappedKey) {
    wrappedKey = await getWorkspaceKey(wsId);
  }
  if (!wrappedKey) {
    console.warn('[meta-yjs] no wrapped key available for workspace', wsId);
    return;
  }
  const identity = await loadOrCreateIdentity();
  if (!identity?.privateKeyHex) {
    console.warn('[meta-yjs] missing encryption identity for meta key');
    return;
  }
  workspaceKeyHex = await unwrapNoteKey(identity.privateKeyHex, wrappedKey);
  await setRoomKey(buildMetaRoomName(wsId), workspaceKeyHex);
}

let observerTimer = null;
let pendingChangedNoteIds = new Set();
let metaFlags = { folders: false, labels: false, labelColors: false };
export function observeWorkspace(callback, debounceMs = 150) {
  const doc = getWorkspaceDoc();
  if (observerAttached) return;
  doc.getMap('folders').observeDeep((_events, transaction) => {
    if (transaction?.origin === 'seed') return;
    metaFlags.folders = true;
    schedule();
  });
  doc.getMap('notes').observeDeep((events, transaction) => {
    if (transaction?.origin === 'seed') return;
    for (const event of events) {
      if (event.path?.length === 1) {
        pendingChangedNoteIds.add(event.path[0]);
      } else if (event.target === doc.getMap('notes')) {
        for (const key of event.keys?.keys() ?? []) {
          pendingChangedNoteIds.add(key);
        }
      }
    }
    schedule();
  });
  doc.getArray('labels').observeDeep((_events, transaction) => {
    if (transaction?.origin === 'seed') return;
    metaFlags.labels = true;
    schedule();
  });
  doc.getMap('labelColors').observeDeep((_events, transaction) => {
    if (transaction?.origin === 'seed') return;
    metaFlags.labelColors = true;
    schedule();
  });
  observerAttached = true;

  function schedule() {
    if (observerTimer) clearTimeout(observerTimer);
    observerTimer = setTimeout(() => {
      observerTimer = null;
      const changed = pendingChangedNoteIds;
      pendingChangedNoteIds = new Set();
      const flags = metaFlags;
      metaFlags = { folders: false, labels: false, labelColors: false };
      callback(changed, flags);
    }, debounceMs);
  }
}

export function transactWorkspace(mutator) {
  getWorkspaceDoc().transact(mutator, 'local');
}

export function syncFolder(folder) {
  if (!folder || !folder.id) return;
  const foldersMap = getWorkspaceDoc().getMap('folders');
  transactWorkspace(() => {
    foldersMap.set(folder.id, objToYMap(folder));
  });
}

export function removeFolder(id) {
  const foldersMap = getWorkspaceDoc().getMap('folders');
  transactWorkspace(() => {
    foldersMap.delete(id);
  });
}

/** Merge partial entries into Yjs Map without deleting absent keys: remote deletions after snapshot survive. */
export function mergeIntoMap(mapName, entries) {
  if (!entries || typeof entries !== 'object') return;
  const map = getWorkspaceDoc().getMap(mapName);
  transactWorkspace(() => {
    for (const [key, value] of Object.entries(entries)) {
      map.set(key, value);
    }
  });
}

/** Diff Yjs Map against desired state, apply minimal set/deletes: O(changed) not clear plus reinsert. */
function syncTombstoneMap(mapName, desired) {
  const map = getWorkspaceDoc().getMap(mapName);
  transactWorkspace(() => {
    const toDelete = [];
    for (const [key] of map.entries()) {
      if (!(key in desired)) {
        toDelete.push(key);
      }
    }
    for (const key of toDelete) {
      map.delete(key);
    }
    for (const [key, value] of Object.entries(desired)) {
      map.set(key, value);
    }
  });
}

export function syncLabel(name) {
  if (typeof name !== 'string' || !name) return;
  const arr = getWorkspaceDoc().getArray('labels');
  transactWorkspace(() => {
    for (let i = 0; i < arr.length; i++) {
      if (arr.get(i) === name) return;
    }
    arr.push([name]);
  });
}

export function removeLabel(name) {
  const arr = getWorkspaceDoc().getArray('labels');
  transactWorkspace(() => {
    for (let i = 0; i < arr.length; i++) {
      if (arr.get(i) === name) {
        arr.delete(i, 1);
        return;
      }
    }
  });
}

export function syncLabelColor(name, color) {
  const map = getWorkspaceDoc().getMap('labelColors');
  transactWorkspace(() => {
    if (color) map.set(name, color);
    else map.delete(name);
  });
}

export function syncNoteMeta(note) {
  if (!note || !note.id) return;
  const notesMap = getWorkspaceDoc().getMap('notes');
  transactWorkspace(() => {
    const meta = {};
    for (const field of NOTE_META_FIELDS) {
      if (field === 'preview') {
        // Short snippet only: full text bloats meta doc, search lives in index.
        meta.preview = String(
          note.preview || note.searchText || note.cardPreview?.text || ''
        ).slice(0, 400);
      } else if (field === 'cardPreview') {
        if (note.cardPreview && typeof note.cardPreview === 'object') {
          meta.cardPreview = note.cardPreview;
        }
      } else if (note[field] !== undefined) {
        meta[field] = note[field];
      }
    }
    notesMap.set(note.id, objToYMap(meta));
  });
}

export function removeNoteMeta(id) {
  const notesMap = getWorkspaceDoc().getMap('notes');
  transactWorkspace(() => {
    notesMap.delete(id);
  });
}

export function syncDeletedAssets(deletedAssets) {
  syncTombstoneMap('deletedAssets', deletedAssets || {});
}

/** Create untitled placeholders for pulled note ids missing from notes map. Skips existing and META_DOC_ID. */
export function reconcileUnknownNotePlaceholders(noteIds) {
  const doc = getWorkspaceDoc();
  const yNotes = doc.getMap('notes');
  const pending = [...new Set(noteIds)].filter(
    (id) => id && id !== META_DOC_ID && !yNotes.has(id)
  );
  for (const id of pending) {
    syncNoteMeta({
      id,
      title: '',
      folderId: '',
      labels: [],
      isArchived: false,
      isLocked: false,
      isBookmarked: false,
      isFullWidth: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      preview: '',
      cardPreview: {},
    });
  }
}
