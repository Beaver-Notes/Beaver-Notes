import { getSyncPath } from './path.js';
import { SYNC_ROOT_DIR, STORAGE_KEY } from './constants.js';
import { syncAssets } from './sync-assets.js';
import {
  flushPendingSyncWrites,
  setCloudBuffer,
  setSyncTrigger,
  hasPendingWrites,
} from './pending-writes.js';
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
import { loadSecureBlob } from '@/utils/crypto/safeStorageBlob.js';
import { fetchCloudKeyParams, publishCloudKeyParams, cloudKeyParamsReachable } from './vault-key-params.js';
import { reconcileSyncKeyParams } from '@/lib/native/security.js';

const PULL_ONLY_INTERVAL_MS = 30_000;

let engine = null;

export function getSyncEngine() {
  return engine;
}

export function initSyncEngine(deps) {
  engine = new SyncEngine(deps);
  return engine;
}

function mergeCursors(cursors, delta, remote) {
  if (!remote) return mergeCursorDelta(cursors, delta);
  let changed = false;
  for (const [workspaceId, notes] of Object.entries(delta || {})) {
    cursors[workspaceId] ||= {};
    for (const [noteId, devices] of Object.entries(notes || {})) {
      cursors[workspaceId][noteId] ||= {};
      for (const [deviceId, value] of Object.entries(devices || {})) {
        const previous = cursors[workspaceId][noteId][deviceId];
        if (!previous || value.ts > previous.ts || (value.ts === previous.ts && value.sequence > previous.sequence)) {
          cursors[workspaceId][noteId][deviceId] = value;
          changed = true;
        }
      }
    }
  }
  return changed;
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

    this._forceFlush = false;
    this._pendingForce = false;
    this._foregroundWake = false;
    this._pullOnlyMode = false;
    this._pullTimer = null;

    setSyncTrigger(() => this.enqueueSync());
  }

  enqueueSync(force = false, pullOnly = false) {
    if (this.syncing) {
      this.pending = true;
      if (force || this._forceFlush) this._pendingForce = true;
      if (pullOnly) this._pullOnlyMode = true;
      return new Promise((resolve, reject) => {
        this.pendingWaiters.push({ resolve, reject });
      });
    }
    this._pullOnlyMode = pullOnly;
    return new Promise((resolve, reject) => {
      this.syncResolve = resolve;
      this.syncReject = reject;
      this._runCycle(force);
    });
  }

  forceSyncNow() {
    return this.enqueueSync(true);
  }

  /**
   * Signal that the app returned from a hidden state.
   * Triggers a pull to pick up remote changes made while backgrounded.
   */
  notifyForeground() {
    this._foregroundWake = true;
    return this.enqueueSync(true);
  }

  /**
   * Start the pull-only periodic timer. Fires every PULL_ONLY_INTERVAL_MS
   * to pull remote changes from other devices. Only pulls — does not push.
   */
  startPullTimer() {
    if (this._pullTimer !== null) return;
    this._pullTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (this.syncing) return;
      this.enqueueSync(false, true).catch(() => {});
    }, PULL_ONLY_INTERVAL_MS);
  }

  stopPullTimer() {
    if (this._pullTimer !== null) {
      clearInterval(this._pullTimer);
      this._pullTimer = null;
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
    this._forceFlush = _force;
    try { emit('sync:status', { status: 'syncing' }); } catch {}

    const isForegroundWake = this._foregroundWake;
    this._foregroundWake = false;
    const pullOnly = this._pullOnlyMode;
    this._pullOnlyMode = false;

    const shouldPull = _force || isForegroundWake || pullOnly || hasPendingWrites();
    const shouldPush = !pullOnly;
    console.log('[sync] _runCycle start', { force: _force, foregroundWake: isForegroundWake, pullOnly, shouldPull, shouldPush });

    let outcome;
    try {
      const syncPath = await getSyncPath();
      const activeTransportNames = this.getActiveTransports();
      const hasLocal = activeTransportNames.includes('local');

      const cloudOnly = activeTransportNames.length === 1 && activeTransportNames[0] === 'cloud';
      setCloudBuffer(cloudOnly ? this.transports.cloud.getCloudBuffer() : null);

      console.log('[sync] cycle config', { syncPath: syncPath || '(none)', transports: activeTransportNames, hasLocal });

      if (!syncPath && hasLocal) {
        console.log('[sync] no syncPath + local only → skip');
        outcome = { ok: true };
        return;
      }

      // Vault key params: reconcile and publish only on force/foreground cycles
      if (_force || isForegroundWake) {
        let syncPassphrase = null;
        try {
          syncPassphrase = await loadSecureBlob('encryptionPassphraseBlob');
        } catch {
          syncPassphrase = null;
        }
        let fetchedRemote = false;
        try {
          const fetched = await fetchCloudKeyParams();
          fetchedRemote = !!fetched;
        } catch {
        }
        try {
          await reconcileSyncKeyParams(syncPassphrase || undefined);
        } catch (e) {
          console.warn('[sync] key-params reconcile failed:', e);
        }
        // Only publish if the server doesn't already have key params.
        // If we just fetched them, publishing would overwrite the vault owner's
        // key params with this device's local key params (which may differ).
        if (cloudKeyParamsReachable() && !fetchedRemote) {
          publishCloudKeyParams().catch(() => {});
        }
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
      if (activeTransportNames.includes('cloud')) {
        await this.transports.cloud.seedOnce().catch(() => {});
      }

      await flushPendingSyncWrites();

      const cursors = await this._loadCursors();

      // Only pull when there's a reason: forced sync, foreground wake, or pending local writes.
      // Idle cycles with nothing to push skip the pull to avoid unnecessary network traffic.
      let cloudBlocked = false;
      if (shouldPull) {
        for (const name of activeTransportNames) {
          const transport = this.transports[name];
          console.log(`[sync] ${name} pull start`);
          let hasMore = true;
          while (hasMore) {
            let pullResult;
            try {
              pullResult = await transport.pull(cursors);
            } catch (e) {
              if (e?.code === 'unlock-required') {
                console.warn('[sync] pull deferred — encryption is locked or not configured');
                try { emit('sync:status', { status: 'unlock-required' }); } catch {}
                if (name === 'cloud') cloudBlocked = true;
                break;
              }
              throw e;
            }
            const { updates } = pullResult;
            console.log(`[sync] ${name} pull got ${updates.length} updates`);
            let cursorsDirty = false;
            for (const upd of updates) {
              applyRemote(upd.noteId, upd.update);
              await appendUpdate(upd.noteId, upd.update, upd.device);
              if (name !== 'cloud') {
                const delta = {};
                delta[`yjs-${upd.device}`] = { ts: upd.ts, seq: upd.seq };
                if (mergeCursorDelta(cursors, delta)) cursorsDirty = true;
              }
            }
            if (name === 'cloud' && pullResult.cursorsDelta) {
              cursorsDirty = mergeCursors(cursors, pullResult.cursorsDelta, true) || cursorsDirty;
            }
            if (cursorsDirty) await this._saveCursors(cursors);
            hasMore = pullResult.hasMore === true;
          }
        }
      } else {
        console.log('[sync] pull skipped — nothing to sync');
      }

      if (shouldPush) {
        for (const name of activeTransportNames) {
          if (cloudBlocked && name === 'cloud') {
            console.log('[sync] cloud push skipped — pull deferred due to unlock-required');
            continue;
          }
          const transport = this.transports[name];
          console.log(`[sync] ${name} push start`);
          let pushResult;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              pushResult = await transport.push(cursors, { force: this._forceFlush });
              break;
            } catch (err) {
              if (attempt === 2) throw err;
              try { emit('sync:status', { status: 'retrying' }); } catch {}
            }
          }
          console.log(`[sync] ${name} push done`, { pushed: pushResult.pushed });
          if (pushResult.cursorsDelta && mergeCursors(cursors, pushResult.cursorsDelta, name === 'cloud')) {
            await this._saveCursors(cursors);
          }
        }
      } else {
        console.log('[sync] push skipped — pull-only mode');
      }

      if (activeTransportNames.includes('cloud') && !cloudBlocked) {
        console.log('[sync] cloud syncAssets start');
        await this.transports.cloud.syncAssets((progress) => {
          try { emit('sync:progress', progress); } catch {}
        }).catch((err) => {
          console.warn('[sync] cloud asset sync failed:', err?.message);
        });
        console.log('[sync] cloud syncAssets done');
      }

      if (hasLocal) {
        await this.transports.local.compact().catch(() => {});
      }

      try {
        localStorage.setItem('sync:lastRunAt', String(Date.now()));
      } catch {
      }

      outcome = { ok: true };
      try { emit('sync:status', { status: 'complete' }); } catch {}
      console.log('[sync] cycle complete ok');
    } catch (err) {
      console.error('[sync] Sync failed:', err);
      console.error('[sync] failed at:', err?.stack?.split('\n')[1]?.trim());
      try { emit('sync:error', { message: err?.message || 'Sync failed' }); } catch {}
      const status = err?.code === 'unlock-required' ? 'unlock-required' :
        err?.status === 401 || err?.status === 403 ? 'authorization-failed' : 'offline';
      try { emit('sync:status', { status }); } catch {}
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
        const pendingForce = this._pendingForce;
        this._pendingForce = false;
        this._runCycle(pendingForce);
      }
    }
  }

  async _loadCursors() {
    return this.storage.get(STORAGE_KEY.SYNC_CURSORS, {}, 'settings');
  }

  async _saveCursors(cursors) {
    return this.storage.set(STORAGE_KEY.SYNC_CURSORS, cursors, 'settings');
  }
}

export function forceSyncNow() {
  if (!engine) return Promise.resolve();
  return engine.forceSyncNow();
}

export function notifyForeground() {
  if (!engine) return;
  return engine.notifyForeground();
}

export function startPullTimer() {
  if (!engine) return;
  return engine.startPullTimer();
}

export function stopPullTimer() {
  if (!engine) return;
  return engine.stopPullTimer();
}

export function trackDeletedAssets(assetType, noteId, fileNames) {
  if (!engine) return;
  return engine.trackDeletedAssets(assetType, noteId, fileNames);
}

export { queueSyncWrite } from './pending-writes.js';
