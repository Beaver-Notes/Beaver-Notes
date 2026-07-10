import { emit } from '@tauri-apps/api/event';
import { getSettingSync } from '@/composable/settings';
import { getAppDirectory } from '@/lib/native/app';
import {
  flushPendingChanges,
  flushPendingChangesIfReady,
  queuePendingChange,
} from './common.js';
import { ensureSyncKeyReadyForWrite } from './crypto.js';
import { resolveActiveTransports } from './transport.js';
import {
  COMMIT_FILE_EXT,
  MAX_COMMITS_BEFORE_COMPACT,
  OpType,
  STORAGE_KEY,
} from './constants.js';
import { SYNC_TRANSPORT } from '@/lib/api/types.js';

// Sync-queue mutex
//
// Rather than chaining syncQueue = syncQueue.then(...), which creates an
// ever-growing promise chain and leaks all intermediate resolved-promise
// objects, we use a simple boolean mutex with a pending flag.
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

function notifyProgress(progress) {
  try {
    emit('sync:progress', progress);
  } catch {
    // event emission is non-critical
  }
}

function isAuthFailure(err) {
  if (!err) return false;
  if (typeof err.isAuthError === 'boolean') return err.isAuthError;
  if (err.status === 401 || err.status === 403) return true;
  return false;
}

function notifyError(err, transportId) {
  try {
    emit('sync:error', {
      message: err?.message || 'Sync failed',
      transport: transportId,
      isAuthError: isAuthFailure(err),
    });
  } catch {}
}

async function trackDeletedAssetsInternal(assetType, noteId, fileNames) {
  if (!fileNames?.length) return;
  const { storage } = await import('@/composable/storage');
  const deletedAssets = await storage.get(STORAGE_KEY.DELETED_ASSETS, {});
  const ts = Date.now();
  for (const file of fileNames) {
    deletedAssets[`${assetType}/${noteId}/${file}`] = ts;
  }
  await storage.set(STORAGE_KEY.DELETED_ASSETS, deletedAssets);
  await trackChange(OpType.DELETED_ASSETS, deletedAssets);
}

export async function trackChange(key, data) {
  if (!getSettingSync('autoSync')) return;
  const transports = await resolveActiveTransports();
  if (!transports.length) return;

  try {
    await ensureSyncKeyReadyForWrite();
    await _flushPendingChanges(transports);
    for (const t of transports) {
      if (typeof t.writeCommit !== 'function') continue;
      try {
        await t.writeCommit({ key, data });
      } catch (err) {
        console.error(`[sync] writeCommit via ${t.id} failed:`, err);
      }
    }
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
  return trackDeletedAssetsInternal(assetType, noteId, fileNames);
}

async function _sync(force = false) {
  if (state.syncing && !force) return;
  const transports = await resolveActiveTransports();
  if (!transports.length) return;
  state.syncing = true;

  const localDir = await getAppDirectory().catch(() => null);
  let changed = false;

  try {
    await _flushPendingChangesIfReady(transports);

    // Apply remote snapshot first (cheapest, biggest payoff)
    for (const t of transports) {
      try {
        if (typeof t.applySnapshotIfNeeded === 'function') {
          const applied = await t.applySnapshotIfNeeded();
          if (applied) changed = true;
        }
      } catch (err) {
        console.error(`[sync] applySnapshot via ${t.id} failed:`, err);
      }
    }

    // Pull remote commits
    for (const t of transports) {
      try {
        const cursors = await _loadCursors();
        if (typeof t.listRemoteCommits !== 'function') continue;
        const remoteCommits = await t.listRemoteCommits(cursors);
        const { applyRemoteOp } = await import('./common.js');
        for (const commit of remoteCommits) {
          for (const op of commit.ops || []) {
            await applyRemoteOp(op, commit.vector);
          }
          cursors[commit.device] = Math.max(
            cursors[commit.device] ?? 0,
            commit.clock
          );
        }
        if (remoteCommits.length > 0) {
          await _saveCursors(cursors);
          changed = true;
        }
      } catch (err) {
        console.error(`[sync] listRemoteCommits via ${t.id} failed:`, err);
      }
    }
    // Asset sync (per transport)
    for (const t of transports) {
      if (typeof t.syncAssets !== 'function' || !localDir) continue;
      try {
        await t.syncAssets(
          localDir,
          (deletedAssets) => trackChange(OpType.DELETED_ASSETS, deletedAssets),
          (progress) => notifyProgress({ ...progress, transport: t.id })
        );
      } catch (err) {
        console.error(`[sync] syncAssets via ${t.id} failed:`, err);
      }
    }

    // Compact
    for (const t of transports) {
      if (typeof t.compactSync !== 'function') continue;
      try {
        const commitsDir = t.getCommitsDir ? await t.getCommitsDir() : null;
        if (commitsDir && typeof t.countCommits === 'function') {
          const count = await t.countCommits(commitsDir);
          if (count > MAX_COMMITS_BEFORE_COMPACT) {
            await t.compactSync();
          }
        } else {
          await t.compactSync();
        }
      } catch (err) {
        console.error(`[sync] compactSync via ${t.id} failed:`, err);
      }
    }

    // Refresh store only when something actually changed remotely
    if (changed) {
      const { useNoteStore } = await import('@/store/note');
      const { useFolderStore } = await import('@/store/folder');
      await Promise.all([
        useNoteStore().retrieve(),
        useFolderStore().retrieve(),
      ]);
    }
  } catch (err) {
    console.error('[sync] Sync failed:', err);
    notifyError(err, transports[0]?.id);
  } finally {
    state.syncing = false;
  }
}

async function _loadCursors() {
  const { useStorage } = await import('@/composable/storage');
  const storage = useStorage();
  return storage.get(STORAGE_KEY.SYNC_CURSORS, {}, 'settings');
}

async function _saveCursors(cursors) {
  const { useStorage } = await import('@/composable/storage');
  const storage = useStorage();
  return storage.set(STORAGE_KEY.SYNC_CURSORS, cursors, 'settings');
}

async function _flushPendingChanges(transports) {
  return flushPendingChanges(async (key, data) => {
    for (const t of transports) {
      if (typeof t.writeCommit !== 'function') continue;
      try {
        await t.writeCommit({ key, data });
      } catch (err) {
        console.error(`[sync] flush writeCommit via ${t.id} failed:`, err);
      }
    }
  });
}

async function _flushPendingChangesIfReady(transports) {
  return flushPendingChangesIfReady(ensureSyncKeyReadyForWrite, (key, data) =>
    _flushPendingChanges(transports)
  );
}

export const __syncConstants = {
  COMMIT_FILE_EXT,
  OpType,
  STORAGE_KEY,
  SYNC_TRANSPORT,
};
