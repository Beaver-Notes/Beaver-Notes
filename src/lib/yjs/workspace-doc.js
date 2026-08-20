/**
 * Workspace Yjs document — single shared Y.Doc for all workspace metadata
 * (folders, labels, deleted-id tombstones, per-note meta). Note *content*
 * lives in separate per-note Y.Docs managed by useNoteYjs.
 *
 * This module owns the document lifecycle (load, persist, observe) and
 * sync helpers. Store hydration lives in meta-store.js.
 */

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
import { getWorkspaceDoc, META_DOC_ID } from './meta-doc.js';
import { getHocuspocusSync, setRoomKey, buildMetaRoomName } from '@/lib/sync/hocuspocus-sync';
import { useWorkspaceStore } from '@/store/workspace';
import { getWorkspaceKey } from '@/lib/api/workspaces';
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
];

let observerAttached = false;
let persistHandlerAttached = false;
let snapshotWritten = false;

// Debounced, merged persistence for the workspace doc. A burst of meta edits
// (bulk drag, multi-rename, bulk label) fires one Y.Doc update event per
// change; persisting each event individually would issue one SQLite IPC +
// AES encrypt per change on the main thread. Instead we buffer the deltas,
// merge them (Y.mergeUpdates — lossless for CRDT state) and write once.
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

// ── Persistence ──────────────────────────────────────────────────────────────

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
    // Update lost despite retries — console.error in retryWrite documents it
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
    // Sync folder write failure is non-fatal — the update is already in SQLite
  }
}

// ── Load / observe ───────────────────────────────────────────────────────────

export async function loadWorkspaceDoc() {
  const doc = getWorkspaceDoc();

  if (!persistHandlerAttached) {
    doc.on('update', (update, origin) => {
      if (origin === 'load' || origin === 'sync' || origin === 'hocuspocus') return;
      pendingMetaUpdates.push(update);
      scheduleMetaFlush();
    });

    // Flush any buffered meta updates on navigation so nothing is lost.
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
    console.error('[meta-yjs] snapshot corrupted — attempting recovery from updates:', err?.message);
    // The compacted snapshot is unreadable (e.g. Unknown content type).
    // Fall through to update-replay recovery below.
  }

  // Recovery: replay individual updates, skipping any that are corrupted.
  // This handles cases where the compacted snapshot is invalid but the
  // underlying update history in SQLite is still partially intact.
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
            // Skip corrupted individual updates — best-effort recovery
          }
        }
        if (applied > 0) {
          console.warn(`[meta-yjs] recovered ${applied}/${updates.length} updates from history`);
        } else {
          console.warn('[meta-yjs] all updates corrupted — starting with empty workspace doc');
        }
      }
    } catch (updateErr) {
      console.warn('[meta-yjs] update replay also failed:', updateErr?.message);
    }
  }

  registerActiveDoc(META_DOC_ID, doc);

  const hocuspocus = getHocuspocusSync();
  const workspaceStore = useWorkspaceStore();
  const wsId = workspaceStore.activeId;
  if (wsId) {
    // The workspace meta doc is encrypted with the WORKSPACE key (the same
    // key used to decrypt the workspace doc). Supply it to the Hocuspocus
    // meta room BEFORE joining so inbound encrypted meta updates can be
    // decrypted — without this the meta doc corrupts and the notes grid
    // goes blank on other devices.
    await ensureMetaRoomKey(wsId).catch((err) => {
      console.warn('[meta-yjs] could not derive workspace meta key:', err?.message || err);
    });
    hocuspocus.joinMetaRoom(wsId);
  }

  return doc;
}

/**
 * Derive the workspace key and register it on the Hocuspocus meta room.
 * Mirrors the per-note key wiring in useNoteYjs.js (setRoomKey around
 * useNoteYjs.js:230) but uses the WORKSPACE key instead of a per-note key.
 *
 * The wrapped key is preferred from the local workspace store (no network),
 * falling back to an API fetch via getWorkspaceKey(wsId).
 */
export async function ensureMetaRoomKey(wsId) {
  if (!wsId) return;
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
  const workspaceKeyHex = await unwrapNoteKey(identity.privateKeyHex, wrappedKey);
  await setRoomKey(buildMetaRoomName(wsId), workspaceKeyHex);
}

let observerTimer = null;
let pendingChangedNoteIds = new Set();
let metaFlags = { folders: false, labels: false, labelColors: false, deleted: false };
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
  doc.getMap('deletedFolderIds').observeDeep((_events, transaction) => {
    if (transaction?.origin === 'seed') return;
    metaFlags.deleted = true;
    schedule();
  });
  doc.getMap('deletedNoteIds').observeDeep((_events, transaction) => {
    if (transaction?.origin === 'seed') return;
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
      metaFlags = { folders: false, labels: false, labelColors: false, deleted: false };
      callback(changed, flags);
    }, debounceMs);
  }
}

// ── Transaction helper ───────────────────────────────────────────────────────

export function transactWorkspace(mutator) {
  getWorkspaceDoc().transact(mutator, 'local');
}

// ── Sync helpers (store -> workspace doc) ────────────────────────────────────

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

// ── Tombstone map helpers ───────────────────────────────────────────────────

/**
 * Merge a partial set of entries into a Yjs Map, only touching keys that
 * changed.  Unlike syncTombstoneMap below, this does NOT delete keys that
 * are absent from the incoming object.  Used by the asset-sync loop so
 * that remote deletions added after the local snapshot are preserved.
 */
export function mergeIntoMap(mapName, entries) {
  if (!entries || typeof entries !== 'object') return;
  const map = getWorkspaceDoc().getMap(mapName);
  transactWorkspace(() => {
    for (const [key, value] of Object.entries(entries)) {
      map.set(key, value);
    }
  });
}

/**
 * Diff a Yjs Map against a desired plain-object state, applying only the
 * minimal set/delete operations.  Previous code did `map.clear()` +
 * re-insert every entry — O(n) mutations + O(n) delete events even when
 * only one key changed.  This is O(m) where m = number of changed keys.
 */
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

export function syncDeletedFolderIds(deletedIds) {
  syncTombstoneMap('deletedFolderIds', deletedIds || {});
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
        // Short display snippet only — search text lives in the search index,
        // not in the workspace doc (full text here is what bloats the meta and
        // makes every launch transfer megabytes).
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

export function syncDeletedNoteIds(deletedIds) {
  syncTombstoneMap('deletedNoteIds', deletedIds || {});
}

export function syncDeletedAssets(deletedAssets) {
  syncTombstoneMap('deletedAssets', deletedAssets || {});
}
