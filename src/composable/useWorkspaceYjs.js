/**
 * Workspace Yjs document — single shared Y.Doc for all workspace metadata
 * (folders, labels, deleted-id tombstones, per-note meta). Note *content*
 * lives in separate per-note Y.Docs managed by useNoteYjs.
 *
 * This module owns the document lifecycle (load, persist, observe) and
 * sync helpers. Store hydration lives in meta-yjs-store.js.
 */

import * as Y from 'yjs';
import { appendUpdate, getSnapshot } from '@/lib/native/yjs.js';
import { readDir as readSyncDir } from '@/lib/native/fs';
import { ensureCommitsDir } from '@/utils/sync/sync-repository.js';
import { getSyncPath } from '@/utils/sync/path.js';
import { getSettingSync } from '@/composable/settings';
import { writeYjsUpdate, writeYjsSnapshot } from '@/utils/sync/sync-yjs.js';
import { encryptJSON } from '@/utils/sync/crypto.js';
import { YJS_UPDATE_EXT } from '@/utils/sync/constants.js';
import { registerActiveDoc } from '@/composable/useNoteYjs.js';
import {
  getDeviceId,
  objToYMap,
} from '@/utils/yjs-helpers.js';
import {
  getWorkspaceDoc,
  META_DOC_ID,
} from './meta-yjs-doc.js';

// Re-export store hydration so consumers keep a single import path
export { writeStoresFromWorkspace, backfillNotePreviews } from './meta-yjs-store.js';

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
];

let observerAttached = false;
let persistHandlerAttached = false;
let snapshotWritten = false;

// ── Persistence ──────────────────────────────────────────────────────────────

async function persistWorkspace(update) {
  if (!update || update.byteLength === 0) return;
  try {
    await appendUpdate(META_DOC_ID, update, getDeviceId());
  } catch {
    // SQLite write is best-effort
  }
  try {
    if (getSettingSync('autoSync')) {
      const syncPath = await getSyncPath();
      if (syncPath) {
        const commitsDir = await ensureCommitsDir(syncPath);

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

        await writeYjsUpdate(commitsDir, META_DOC_ID, update, encryptJSON);
      }
    }
  } catch {
    // sync folder write is best-effort
  }
}

// ── Load / observe ───────────────────────────────────────────────────────────

export async function loadWorkspaceDoc() {
  const doc = getWorkspaceDoc();

  if (!persistHandlerAttached) {
    doc.on('update', (update, origin) => {
      if (origin === 'load' || origin === 'sync') return;
      persistWorkspace(update);
    });
    persistHandlerAttached = true;
  }

  try {
    const snapshot = await getSnapshot(META_DOC_ID);
    if (snapshot && snapshot.length > 0) {
      Y.applyUpdate(
        doc,
        snapshot instanceof Uint8Array ? snapshot : new Uint8Array(snapshot),
        'load'
      );
    }
  } catch (err) {
    console.error('[meta-yjs] Failed to load snapshot:', err);
  }

  registerActiveDoc(META_DOC_ID, doc);

  return doc;
}

let observerTimer = null;
export function observeWorkspace(callback, debounceMs = 150) {
  const doc = getWorkspaceDoc();
  if (observerAttached) return;
  doc.getMap('folders').observeDeep(() => schedule());
  doc.getMap('notes').observeDeep(() => schedule());
  doc.getMap('deletedFolderIds').observeDeep(() => schedule());
  doc.getMap('deletedNoteIds').observeDeep(() => schedule());
  doc.getArray('labels').observeDeep(() => schedule());
  doc.getMap('labelColors').observeDeep(() => schedule());
  observerAttached = true;

  function schedule() {
    if (observerTimer) clearTimeout(observerTimer);
    observerTimer = setTimeout(() => callback(), debounceMs);
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
        meta.preview =
          note.preview || note.searchText || note.cardPreview?.text || '';
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
