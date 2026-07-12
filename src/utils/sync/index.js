import {
  encryptJSON,
  decryptJSON,
} from './crypto.js';
import { reconcileSyncKeyParams } from '@/lib/native/security.js';
import { getSyncPath } from './path.js';
import { useStorage } from '@/composable/storage';
import { path } from '@/lib/tauri-bridge';
import { getAppDirectory } from '@/lib/native/app';
import { ensureCommitsDir } from './sync-repository.js';
import { syncAssets } from './sync-assets.js';
import {
  listRemoteYjsUpdates,
  compactWorkspaceYjs,
} from './sync-yjs.js';
import { emit } from '@tauri-apps/api/event';
import { applyRemote } from '@/composable/useNoteYjs';
import { appendUpdate } from '@/lib/native/yjs.js';
import { STORAGE_KEY, SYNC_ROOT_DIR } from './constants.js';
import { syncDeletedAssets } from '@/composable/useWorkspaceYjs';
import { getWorkspaceDoc } from '@/composable/meta-yjs-doc.js';
import { yMapToObj } from '@/utils/yjs-helpers.js';

const storage = useStorage();

// ─── Sync-queue mutex ────────────────────────────────────────────────────────
//
// Rather than chaining syncQueue = syncQueue.then(...) — which creates an
// ever-growing promise chain and leaks all intermediate resolved-promise
// objects — we use a simple boolean mutex with a "pending" flag.
// If a sync is already running when another is requested we just note that
// a re-run is needed; when the current run finishes it starts one more.

const state = { syncing: false, pending: false };

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

export function forceSyncNow() {
  return enqueueSync(true);
}

export async function trackDeletedAssets(assetType, noteId, fileNames) {
  if (!fileNames?.length) return;
  const deletedAssets = yMapToObj(getWorkspaceDoc().getMap('deletedAssets'));
  const ts = Date.now();
  for (const file of fileNames) {
    deletedAssets[`${assetType}/${noteId}/${file}`] = ts;
  }
  syncDeletedAssets(deletedAssets);
}

async function _sync(force = false) {
  if (state.syncing && !force) return;

  const syncPath = await getSyncPath();
  if (!syncPath) return;

  // Keep the shared items key (keyParams.json) in sync so every device derives
  // the same items key. Safe to run every cycle; cheap when already consistent.
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
    const cursors = await _loadCursors();

    // ── Asset sync (bidirectional file copy) ─────────────────────────────
    const localDir = await getAppDirectory();
    await syncAssets(
      localDir,
      syncDir,
      (progress) => {
        try {
          emit('sync:progress', progress);
        } catch {
          // event emission is non-critical
        }
      }
    );

    // ── Yjs sync (per-note content + workspace metadata) ─────────────────
    const remoteYjsUpdates = await listRemoteYjsUpdates(
      commitsDir,
      cursors,
      decryptJSON
    ).catch(() => []);
    for (const upd of remoteYjsUpdates) {
      applyRemote(upd.noteId, upd.update);
      await appendUpdate(upd.noteId, upd.update, upd.device);
      const cursorKey = `yjs-${upd.device}`;
      cursors[cursorKey] = Math.max(cursors[cursorKey] ?? 0, upd.ts);
    }
    if (remoteYjsUpdates.length > 0) {
      await _saveCursors(cursors);
    }

    // ── Compaction: merge many workspace .yjs.json files into one ──────────
    try {
      await compactWorkspaceYjs(commitsDir, decryptJSON, encryptJSON);
    } catch {
      // compaction is best-effort
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
