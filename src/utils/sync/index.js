import * as Y from 'yjs';
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
  writeYjsSnapshot,
} from './sync-yjs.js';
import { emit } from '@tauri-apps/api/event';
import { applyRemote } from '@/composable/useNoteYjs';
import { appendUpdate, getSnapshot, getUpdates } from '@/lib/native/yjs.js';
import { STORAGE_KEY, SYNC_ROOT_DIR, YJS_UPDATE_EXT } from './constants.js';
import { syncDeletedAssets } from '@/composable/useWorkspaceYjs';
import {
  getWorkspaceDoc,
  META_DOC_ID,
} from '@/composable/meta-yjs-doc.js';
import {
  yMapToObj,
  toUint8Array,
  applyUpdatesToDoc,
} from '@/utils/yjs-helpers.js';
import { readDir as readSyncDir } from '@/lib/native/fs';

const storage = useStorage();

// ─── Sync-queue mutex ────────────────────────────────────────────────────────
//
// Rather than chaining syncQueue = syncQueue.then(...) — which creates an
// ever-growing promise chain and leaks all intermediate resolved-promise
// objects — we use a simple boolean mutex with a "pending" flag.
// If a sync is already running when another is requested we just note that
// a re-run is needed; when the current run finishes it starts one more.

const state = { syncing: false, pending: false };

// When multiple callers enqueue a sync while one is already running, they all
// await the same pending run's outcome instead of a promise that never settles.
let syncResolve = null;
let syncReject = null;
let pendingWaiters = [];

function enqueueSync(force = false) {
  if (state.syncing) {
    state.pending = true;
    // Return a promise that resolves/rejects with the coalesced run's result.
    return new Promise((resolve, reject) => {
      pendingWaiters.push({ resolve, reject });
    });
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
  let outcome;
  try {
    await _sync(force);
    outcome = { ok: true };
  } catch (err) {
    outcome = { ok: false, err };
  } finally {
    // Resolve the primary caller.
    if (outcome.ok) syncResolve?.();
    else syncReject?.(outcome.err);
    syncResolve = null;
    syncReject = null;
    state.syncing = false;

    // Any callers that coalesced into this run get the same outcome.
    const waiters = pendingWaiters;
    pendingWaiters = [];
    for (const { resolve, reject } of waiters) {
      if (outcome.ok) resolve();
      else reject(outcome.err);
    }

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

/**
 * Write a full snapshot of the workspace doc and every note doc into the
 * shared commits/ directory.  Called once the first time sync runs and
 * the commits directory is empty, so new devices joining the sync group
 * get all data in one pass.
 */
async function writeInitialSnapshots(commitsDir) {
  const workspaceDoc = getWorkspaceDoc();

  // 1. Workspace metadata snapshot
  const wsState = Y.encodeStateAsUpdate(workspaceDoc);
  await writeYjsSnapshot(commitsDir, META_DOC_ID, wsState, encryptJSON);

  // 2. Per-note content snapshots
  const notesMap = workspaceDoc.getMap('notes');
  const noteIds = Array.from(notesMap.keys()).filter(
    (id) => typeof id === 'string' && id.trim().length > 0 && id !== 'undefined'
  );

  await Promise.all(
    noteIds.map(async (noteId) => {
      const doc = new Y.Doc();
      try {
        let loaded = false;
        try {
          const snapshot = await getSnapshot(noteId);
          if (snapshot && snapshot.length > 0) {
            Y.applyUpdate(doc, toUint8Array(snapshot));
            loaded = true;
          }
        } catch {
          // snapshot unavailable — fall back to updates
        }
        if (!loaded) {
          try {
            const updates = await getUpdates(noteId);
            applyUpdatesToDoc(doc, updates);
          } catch {
            // no updates either — skip this note
          }
        }
        const state = Y.encodeStateAsUpdate(doc);
        if (state.byteLength > 0) {
          await writeYjsSnapshot(commitsDir, noteId, state, encryptJSON);
        }
      } catch (err) {
        console.warn(`[sync] initial snapshot failed for ${noteId}:`, err);
      } finally {
        doc.destroy();
      }
    })
  );
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

    // ── Seed commits dir on first sync ───────────────────────────────────
    // When the commits directory has no Yjs files yet this is the first
    // device seeding the sync group.  Write full snapshots of the workspace
    // doc and every note so downstream devices can pull everything in one
    // pass instead of waiting for incremental mutations.
    try {
      const files = await readSyncDir(commitsDir).catch(() => []);
      const hasYjsFiles = files.some((f) => f.endsWith(YJS_UPDATE_EXT));
      if (!hasYjsFiles) {
        await writeInitialSnapshots(commitsDir);
      }
    } catch {
      // seeding is best-effort
    }

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
