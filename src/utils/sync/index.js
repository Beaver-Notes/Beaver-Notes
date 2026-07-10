import {
  encryptJSON,
  decryptJSON,
  ensureSyncKeyReadyForWrite,
} from './crypto.js';
import { reconcileSyncKeyParams } from '@/lib/native/security.js';
import { getSyncPath } from './path.js';
import { getSettingSync } from '@/composable/settings';
import { useStorage } from '@/composable/storage';
import { useNoteStore } from '@/store/note.js';
import { useFolderStore } from '@/store/folder.js';
import { path } from '@/lib/tauri-bridge';
import { getAppDirectory } from '@/lib/native/app';
import {
  readDir as readSyncDir,
} from '@/lib/native/fs';
import {
  applyGenesisIfNeeded,
  applySnapshotIfNeeded,
  compactSync,
  ensureCommitsDir,
  flushPendingChanges,
  flushPendingChangesIfReady,
  genesisExists,
  listRemoteCommits,
  queuePendingChange,
  writeCommit,
  writeGenesisState,
} from './sync-repository.js';
import { applyRemoteOp } from './sync-apply.js';
import { syncAssets } from './sync-assets.js';
import { emit } from '@tauri-apps/api/event';
import {
  COMMIT_FILE_EXT,
  MAX_COMMITS_BEFORE_COMPACT,
  OpType,
  STORAGE_KEY,
  SYNC_ROOT_DIR,
} from './constants.js';

const storage = useStorage();

// ─── Sync-queue mutex ────────────────────────────────────────────────────────
//
// Rather than chaining syncQueue = syncQueue.then(...) — which creates an
// ever-growing promise chain and leaks all intermediate resolved-promise
// objects — we use a simple boolean mutex with a "pending" flag.
// If a sync is already running when another is requested we just note that
// a re-run is needed; when the current run finishes it starts one more.

const state = { syncing: false, pending: false };

// ─── Coalescing writer ───────────────────────────────────────────────────────
//
// Rapid successive changes (e.g. typing) are coalesced into a single commit
// cycle. The latest value for each key is kept; after a quiet period the
// accumulated changes are flushed as individual commits.
//
//  COALESCE_MS  —  idle time before flushing (reset on each new change)
//  MAX_WAIT_MS  —  maximum time before a flush is forced regardless of activity

const COALESCE_MS = 1500;
const MAX_WAIT_MS = 5000;

let coalesced = new Map();
let coalesceTimer = null;
let coalesceMaxTimer = null;

function _coalesceFlush() {
  coalesceTimer = null;
  coalesceMaxTimer = null;

  if (coalesced.size === 0) return;

  const batch = coalesced;
  coalesced = new Map();

  _flushCoalesced(batch).catch((err) =>
    console.error('[sync] Coalesced flush failed:', err)
  );
}

async function _flushCoalesced(batch) {
  try {
    await ensureSyncKeyReadyForWrite();
    await _flushPendingChanges();

    for (const [key, data] of batch) {
      await _writeCommit(key, data);
    }

    enqueueSync();
  } catch (error) {
    for (const [key, data] of batch) {
      try {
        await queuePendingChange(key, data);
      } catch {
        // individual queue failures are non-fatal
      }
    }
    console.warn(
      '[sync] Coalesced changes queued locally — encryption may be locked.',
      error
    );
  }
}

let syncResolve = null;
let syncReject = null;

function enqueueSync(force = false) {
  if (state.syncing) {
    state.pending = true;
    return new Promise(() => {}); // never settles — chained call ignored
  }
  return new Promise((resolve, reject) => {
    syncResolve = resolve;
    syncReject = reject;
    _runSync(force);
  });
}

async function _runSync(force = false) {
  state.syncing = true;
  state.pending = false;
  try {
    await _sync(force);
    syncResolve?.();
  } catch (err) {
    syncReject?.(err);
  } finally {
    syncResolve = null;
    syncReject = null;
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

  coalesced.set(key, data);

  if (coalesceTimer) clearTimeout(coalesceTimer);
  coalesceTimer = setTimeout(_coalesceFlush, COALESCE_MS);

  if (!coalesceMaxTimer) {
    coalesceMaxTimer = setTimeout(_coalesceFlush, MAX_WAIT_MS);
  }
}

export function forceSyncNow() {
  return enqueueSync(true);
}

export async function trackDeletedAssets(assetType, noteId, fileNames) {
  if (!fileNames?.length) return;

  const deletedAssets = await storage.get(STORAGE_KEY.DELETED_ASSETS, {});
  const ts = Date.now();

  for (const file of fileNames) {
    deletedAssets[`${assetType}/${noteId}/${file}`] = ts;
  }

  await storage.set(STORAGE_KEY.DELETED_ASSETS, deletedAssets);
  await trackChange(OpType.DELETED_ASSETS, deletedAssets);
}

async function _sync(force = false) {
  if (state.syncing && !force) return;

  const syncPath = await getSyncPath();
  if (!syncPath) return;

  // Keep the shared items key (keyParams.json) in sync so every device derives
  // the same items key. Safe to run every cycle; cheap when already consistent.
  // The stored passphrase lets a joining device adopt the shared items key.
  let syncPassphrase = null;
  try {
    const { loadSecureBlob } = await import('@/utils/crypto/safeStorageBlob.js');
    syncPassphrase = await loadSecureBlob('encryptionPassphraseBlob');
  } catch {
    syncPassphrase = null;
  }
  try {
    await reconcileSyncKeyParams(syncPassphrase || undefined);
  } catch (e) {
    console.warn('[sync] key-params reconcile failed:', e);
  }

  state.syncing = true;

  try {
    const syncDir = path.join(syncPath, SYNC_ROOT_DIR);
    const commitsDir = await ensureCommitsDir(syncPath);
    await _flushPendingChangesIfReady();

    // ── Genesis (initial state propagation) ─────────────────────────────
    // First device: write the genesis snapshot so subsequent devices have
    // a consistent starting point. Subsequent devices: apply genesis as
    // the authoritative baseline before processing any commits.
    let genesisApplied = false;
    const hasGenesis = await genesisExists(syncDir);
    if (!hasGenesis) {
      await writeGenesisState({ syncDir, encryptJSON });
    } else {
      const result = await applyGenesisIfNeeded({
        syncDir,
        decryptJSON,
        saveCursors: _saveCursors,
      });
      if (result === 'encrypted') {
        console.warn(
          '[sync] Genesis is encrypted — set up encryption with the same password to sync.'
        );
        try {
          emit('sync:error', {
            message:
              'The sync data is encrypted. Go to Security settings and enter the same encryption password used on your other device.',
            code: 'GENESIS_ENCRYPTED',
          });
        } catch {}
      } else {
        genesisApplied = result;
      }
    }

    const snapshotApplied = await applySnapshotIfNeeded({
      syncDir,
      commitsDir,
      decryptJSON,
      saveCursors: _saveCursors,
    });
    const cursors = await _loadCursors();
    const remoteCommits = await listRemoteCommits(
      commitsDir,
      cursors,
      decryptJSON
    );

    for (const commit of remoteCommits) {
      for (const op of commit.ops) {
        await applyRemoteOp(op, commit.vector);
      }
      cursors[commit.device] = Math.max(
        cursors[commit.device] ?? 0,
        commit.clock
      );
    }

    if (remoteCommits.length > 0) {
      await _saveCursors(cursors);
    }

    const localDir = await getAppDirectory();
    await syncAssets(
      localDir,
      syncDir,
      async (deletedAssets) => {
        await trackChange(OpType.DELETED_ASSETS, deletedAssets);
      },
      (progress) => {
        try {
          emit('sync:progress', progress);
        } catch {
          // event emission is non-critical
        }
      }
    );

    const allFiles = await readSyncDir(commitsDir).catch(() => []);
    if (
      allFiles.filter((f) => f.endsWith(COMMIT_FILE_EXT)).length >
      MAX_COMMITS_BEFORE_COMPACT
    ) {
      await compactSync({
        syncDir,
        commitsDir,
        encryptJSON,
        loadCursors: _loadCursors,
        saveCursors: _saveCursors,
      });
    }

    if (remoteCommits.length > 0 || snapshotApplied || genesisApplied) {
      await Promise.all([
        useNoteStore().retrieve(),
        useFolderStore().retrieve(),
      ]);
    }
  } catch (err) {
    console.error('[sync] Sync failed:', err);
    try {
      emit('sync:error', { message: err?.message || 'Sync failed' });
    } catch {}
  } finally {
    state.syncing = false;
  }
}

async function _loadCursors() {
  return storage.get(STORAGE_KEY.SYNC_CURSORS, {}, 'settings');
}

async function _saveCursors(cursors) {
  return storage.set(STORAGE_KEY.SYNC_CURSORS, cursors, 'settings');
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
  return flushPendingChangesIfReady(ensureSyncKeyReadyForWrite, (key, data) =>
    _writeCommit(key, data)
  );
}
