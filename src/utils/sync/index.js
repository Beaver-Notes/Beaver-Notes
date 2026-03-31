import {
  encryptJSON,
  decryptJSON,
  ensureSyncKeyReadyForWrite,
} from './crypto.js';
import { getSyncPath } from './path.js';
import { getSettingSync } from '@/composable/settings';
import { useStorage } from '@/composable/storage';
import { useNoteStore } from '@/store/note.js';
import { useFolderStore } from '@/store/folder.js';
import { path } from '@/lib/tauri-bridge';
import { ensureSyncDir, readSyncDir } from '@/lib/native/sync';
import {
  applySnapshotIfNeeded,
  compactSync,
  ensureCommitsDir,
  flushPendingChanges,
  flushPendingChangesIfReady,
  listRemoteCommits,
  queuePendingChange,
  writeCommit,
} from './sync-repository.js';
import { applyRemoteOp } from './sync-apply.js';
import { syncAssets } from './sync-assets.js';

const storage = useStorage();

// ─── Sync-queue mutex ────────────────────────────────────────────────────────
//
// Rather than chaining syncQueue = syncQueue.then(...) — which creates an
// ever-growing promise chain and leaks all intermediate resolved-promise
// objects — we use a simple boolean mutex with a "pending" flag.
// If a sync is already running when another is requested we just note that
// a re-run is needed; when the current run finishes it starts one more.

const state = { syncing: false, pending: false };

function enqueueSync(force = false) {
  if (state.syncing) {
    state.pending = true;
    return;
  }
  _runSync(force);
}

async function _runSync(force = false) {
  state.syncing = true;
  state.pending = false;
  try {
    await _sync(force);
  } finally {
    state.syncing = false;
    if (state.pending) {
      state.pending = false;
      _runSync(false);
    }
  }
}

export async function trackChange(key, data) {
  if (!getSettingSync('autoSync')) return;
  const syncPath = await getSyncPath();
  if (!syncPath) return;

  try {
    await ensureSyncKeyReadyForWrite();
    await _flushPendingChanges();
    await _writeCommit(key, data);
    enqueueSync();
  } catch (error) {
    try {
      await queuePendingChange(key, data);
      console.warn(
        '[sync] Commit queued locally because sync encryption is locked or temporarily unavailable. It will be written after unlock.',
        error
      );
    } catch (queueError) {
      console.error('[sync] Failed to queue pending commit:', queueError);
    }
  }
}

export function forceSyncNow() {
  return enqueueSync(true);
}

export async function trackDeletedAssets(assetType, noteId, fileNames) {
  if (!fileNames?.length) return;

  const deletedAssets = await storage.get('deletedAssets', {});
  const ts = Date.now();

  for (const file of fileNames) {
    deletedAssets[`${assetType}/${noteId}/${file}`] = ts;
  }

  await storage.set('deletedAssets', deletedAssets);
  await trackChange('deletedAssets', deletedAssets);
}

async function _sync(force = false) {
  if (state.syncing && !force) return;

  const syncPath = await getSyncPath();
  if (!syncPath) return;

  state.syncing = true;

  try {
    const syncDir = path.join(syncPath, 'BeaverNotesSync');
    const commitsDir = await ensureCommitsDir(syncPath);
    await _flushPendingChangesIfReady();

    const snapshotApplied = await applySnapshotIfNeeded({
      syncDir,
      commitsDir,
      decryptJSON,
      saveCursors: _saveCursors,
    });
    const cursors = await _loadCursors();
    const remoteCommits = await listRemoteCommits(commitsDir, cursors, decryptJSON);

    for (const commit of remoteCommits) {
      for (const op of commit.ops) {
        await applyRemoteOp(op, commit.vector);
      }
      cursors[commit.device] = Math.max(cursors[commit.device] ?? 0, commit.clock);
    }

    if (remoteCommits.length > 0) {
      await _saveCursors(cursors);
    }

    const localDir = await storage.get('dataDir', '', 'settings');
    await syncAssets(localDir, syncDir, async (deletedAssets) => {
      await trackChange('deletedAssets', deletedAssets);
    });

    const allFiles = await readSyncDir(commitsDir).catch(() => []);
    if (allFiles.filter((f) => f.endsWith('.json')).length > 200) {
      await compactSync({
        syncDir,
        commitsDir,
        encryptJSON,
        loadCursors: _loadCursors,
        saveCursors: _saveCursors,
      });
    }

    if (remoteCommits.length > 0 || snapshotApplied) {
      await Promise.all([
        useNoteStore().retrieve(),
        useFolderStore().retrieve(),
      ]);
    }
  } catch (err) {
    console.error('[sync] Sync failed:', err);
  } finally {
    state.syncing = false;
  }
}

async function _loadCursors() {
  return storage.get('syncCursors', {}, 'settings');
}

async function _saveCursors(cursors) {
  return storage.set('syncCursors', cursors, 'settings');
}

async function _getCommitsDir() {
  const syncPath = await getSyncPath();
  if (!syncPath) return null;
  return ensureCommitsDir(syncPath);
}

async function _writeCommit(key, data) {
  const commitsDir = await _getCommitsDir();
  if (!commitsDir) return null;

  return writeCommit({
    key,
    data,
    commitsDir,
    encryptJSON,
    loadCursors: _loadCursors,
    saveCursors: _saveCursors,
  });
}

async function _flushPendingChanges() {
  return flushPendingChanges((key, data) => _writeCommit(key, data));
}

async function _flushPendingChangesIfReady() {
  return flushPendingChangesIfReady(
    ensureSyncKeyReadyForWrite,
    (key, data) => _writeCommit(key, data)
  );
}
