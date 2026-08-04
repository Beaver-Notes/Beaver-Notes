import { getSyncPath } from './path.js';
import { SYNC_ROOT_DIR, STORAGE_KEY } from './constants.js';
import { syncAssets } from './sync-assets.js';
import { flushPendingSyncWrites } from './pending-writes.js';
import { mergeCursorDelta } from './transports/transport.js';
import { applyRemote } from '@/composable/useNoteYjs.js';
import { appendUpdate } from '@/lib/native/yjs.js';
import { getAppDirectory } from '@/lib/native/app';
import { path } from '@/lib/tauri-bridge';
import { emit } from '@tauri-apps/api/event';
import { getWorkspaceDoc } from '@/composable/meta-yjs-doc.js';
import { yMapToObj } from '@/utils/yjs-helpers.js';
import { syncDeletedAssets } from '@/composable/useWorkspaceYjs';
import { speed } from '@/utils/speed.js';

const SYNC_INTERVAL_MS = 10000;

let engine = null;

export function getSyncEngine() {
  return engine;
}

export function initSyncEngine(deps) {
  engine = new SyncEngine(deps);
  return engine;
}

export class SyncEngine {
  constructor({ transports, storage, getActiveTransports }) {
    this.transports = transports;
    this.storage = storage;
    this.getActiveTransports = getActiveTransports;

    this.syncing = false;
    this.pending = false;
    this.syncResolve = null;
    this.syncReject = null;
    this.pendingWaiters = [];

    this.periodicTimer = null;
    this.periodicEnabled = false;

    this._forceFlush = false;
  }

  enqueueSync(force = false) {
    if (this.syncing) {
      this.pending = true;
      return new Promise((resolve, reject) => {
        this.pendingWaiters.push({ resolve, reject });
      });
    }
    return new Promise((resolve, reject) => {
      this.syncResolve = resolve;
      this.syncReject = reject;
      this._runCycle(force);
    });
  }

  forceSyncNow() {
    return this.enqueueSync(true);
  }

  setPeriodicSyncEnabled(enabled) {
    this.periodicEnabled = Boolean(enabled);
    if (this.periodicEnabled) {
      this._schedulePeriodicSync();
    } else {
      this._stopPeriodicSync();
    }
  }

  async flush() {
    this._forceFlush = true;
    await this.enqueueSync(true);
    this._forceFlush = false;
  }

  async trackDeletedAssets(assetType, noteId, fileNames) {
    if (!fileNames?.length) return;
    const deletedAssets = yMapToObj(getWorkspaceDoc().getMap('deletedAssets'));
    const ts = Date.now();
    for (const file of fileNames) {
      deletedAssets[`${assetType}/${noteId}/${file}`] = ts;
    }
    syncDeletedAssets(deletedAssets);
  }

  async _runCycle(_force = false) {
    const t = speed('sync_cycle');
    this.syncing = true;
    this.pending = false;

    let outcome;
    try {
      const syncPath = await getSyncPath();
      const activeTransportNames = this.getActiveTransports();
      const hasLocal = activeTransportNames.includes('local');

      if (!syncPath && hasLocal) {
        outcome = { ok: true };
        return;
      }

      let syncPassphrase = null;
      try {
        const { loadSecureBlob } = await import('@/utils/crypto/safeStorageBlob.js');
        syncPassphrase = await loadSecureBlob('encryptionPassphraseBlob');
      } catch {
        syncPassphrase = null;
      }
      try {
        const { fetchCloudKeyParams } = await import('./vault-key-params.js');
        await fetchCloudKeyParams().catch(() => {});
      } catch {
      }
      try {
        const { reconcileSyncKeyParams } = await import('@/lib/native/security.js');
        await reconcileSyncKeyParams(syncPassphrase || undefined);
      } catch (e) {
        console.warn('[sync] key-params reconcile failed:', e);
      }

      if (syncPath) {
        try {
          const syncDir = path.join(syncPath, SYNC_ROOT_DIR);
          const localDir = await getAppDirectory();
          await syncAssets(localDir, syncDir, (progress) => {
            try { emit('sync:progress', progress); } catch {}
          });
        } catch {
        }
      }

      if (hasLocal) {
        await this.transports.local.seedOnce().catch(() => {});
      }

      await flushPendingSyncWrites();

      const cursors = await this._loadCursors();

      for (const name of activeTransportNames) {
        const transport = this.transports[name];
        const { updates } = await transport.pull(cursors);
        for (const upd of updates) {
          applyRemote(upd.noteId, upd.update);
          await appendUpdate(upd.noteId, upd.update, upd.device);
          const delta = {};
          delta[`yjs-${upd.device}`] = { ts: upd.ts, seq: upd.seq };
          if (mergeCursorDelta(cursors, delta)) {
            await this._saveCursors(cursors);
          }
        }
      }

      for (const name of activeTransportNames) {
        const transport = this.transports[name];
        const { cursorsDelta } = await transport.push(cursors, {
          force: this._forceFlush,
        });
        if (mergeCursorDelta(cursors, cursorsDelta)) {
          await this._saveCursors(cursors);
        }
      }

      if (hasLocal) {
        await this.transports.local.compact().catch(() => {});
      }

      try {
        localStorage.setItem('sync:lastRunAt', String(Date.now()));
      } catch {
      }

      outcome = { ok: true };
    } catch (err) {
      console.error('[sync] Sync failed:', err);
      try { emit('sync:error', { message: err?.message || 'Sync failed' }); } catch {}
      outcome = { ok: false, err };
    } finally {
      t?.end();
      if (outcome.ok) this.syncResolve?.();
      else this.syncReject?.(outcome.err);
      this.syncResolve = null;
      this.syncReject = null;
      this.syncing = false;

      const waiters = this.pendingWaiters;
      this.pendingWaiters = [];
      for (const { resolve, reject } of waiters) {
        if (outcome.ok) resolve();
        else reject(outcome.err);
      }

      if (this.pending) {
        this.pending = false;
        this._runCycle(false);
      }
    }
  }

  async _loadCursors() {
    return this.storage.get(STORAGE_KEY.SYNC_CURSORS, {}, 'settings');
  }

  async _saveCursors(cursors) {
    return this.storage.set(STORAGE_KEY.SYNC_CURSORS, cursors, 'settings');
  }

  _schedulePeriodicSync() {
    if (this.periodicTimer !== null) return;
    this.periodicTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      this.forceSyncNow().catch(() => {});
    }, SYNC_INTERVAL_MS);
  }

  _stopPeriodicSync() {
    if (this.periodicTimer !== null) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }
}

export function forceSyncNow() {
  if (!engine) return Promise.resolve();
  return engine.forceSyncNow();
}

export function setPeriodicSyncEnabled(enabled) {
  if (!engine) return;
  return engine.setPeriodicSyncEnabled(enabled);
}

export function trackDeletedAssets(assetType, noteId, fileNames) {
  if (!engine) return;
  return engine.trackDeletedAssets(assetType, noteId, fileNames);
}

export { queueSyncWrite } from './pending-writes.js';
