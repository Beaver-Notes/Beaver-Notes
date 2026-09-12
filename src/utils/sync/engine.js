import { getSyncPath } from './path.js';
import { SYNC_ROOT_DIR } from './constants.js';
import { syncAssets, yieldToUi } from './sync-assets.js';
import {
  flushPendingSyncWrites,
  setCloudBuffer,
  setSyncTrigger,
  hasPendingWrites,
} from './pending-writes.js';
import { applyRemote } from '@/lib/yjs/shared.js';
import { appendUpdate, appendBatch } from '@/lib/native/yjs.js';
import { getAppDirectory } from '@/lib/native/app';
import { path } from '@/lib/tauri-bridge';
import { emit } from '@tauri-apps/api/event';
import { getWorkspaceDoc } from '@/lib/yjs/meta-doc.js';
import { yMapToObj } from '@/lib/yjs/helpers.js';
import { syncDeletedAssets, reconcileUnknownNotePlaceholders, writeStoresFromWorkspace } from '@/lib/yjs/workspace-doc';
import { speed } from '@/utils/speed.js';
import { loadSecureBlob } from '@/utils/crypto/safeStorageBlob.js';
import { fetchCloudKeyParams } from './vault-key-params.js';
import { reconcileSyncKeyParams } from '@/lib/native/security.js';
import * as Y from 'yjs';
import { getCurrentStateVector, saveStateVector } from './state-vector.js';
import { getActiveDoc } from '@/lib/yjs/shared.js';
import { isRustSyncActive, kickRustSync, refreshRustOwnership } from './rust-shim.js';
import { logger } from '@/utils/logger';

const APPLY_YIELD_STRIDE = 25;

const PULL_ONLY_INTERVAL_MS = 30_000;
const MAX_PULL_PAGES = 20;

function settleSync(inst, outcome) {
  if (outcome.ok) inst.syncResolve?.();
  else inst.syncReject?.(outcome.err);
  inst.syncResolve = null;
  inst.syncReject = null;
  inst.syncing = false;
  const waiters = inst.pendingWaiters;
  inst.pendingWaiters = [];
  for (const { resolve, reject } of waiters) {
    if (outcome.ok) resolve();
    else reject(outcome.err);
  }
}

let engine = null;

export function getSyncEngine() {
  return engine;
}

export function initSyncEngine(deps) {
  try { engine?.stopPullTimer(); } catch {}
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

    this._forceFlush = false;
    this._pendingForce = false;
    this._foregroundWake = false;
    this._pullOnlyMode = false;
    this._pullTimer = null;
    this._idlePullBackoff = false;

    setSyncTrigger(() => this.enqueueSync());
  }

  enqueueSync(force = false, pullOnly = false) {
    if (this.syncing) {
      this.pending = true;
      if (force || this._forceFlush) this._pendingForce = true;
      if (pullOnly) this._pullOnlyMode = true;
      if (this.pendingWaiters.length >= 50) {
        const dropped = this.pendingWaiters.shift();
        try { dropped.resolve(); } catch {}
      }
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

  notifyForeground() {
    this._foregroundWake = true;
    if (isRustSyncActive() && kickRustSync()) {
      this._foregroundWake = false;
      return Promise.resolve(true);
    }
    return this.enqueueSync(true);
  }

  startPullTimer() {
    if (this._pullTimer !== null) return;
    const transports = this.getActiveTransports();
    const cloudOnly = transports.length === 1 && transports[0] === 'cloud';
    if (cloudOnly) return;
    this._pullTimer = setInterval(async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (this.syncing) return;

      const syncPath = await getSyncPath();
      const transports = this.getActiveTransports();
      if (!syncPath && transports.length === 1 && transports[0] === 'local') return;

      if (this._idlePullBackoff) {
        this._idlePullBackoff = false;
        return;
      }
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

  _resolveSkip() {
    this.syncing = false;
    this.pending = false;
    this._pullOnlyMode = false;
    this._foregroundWake = false;
    this._forceFlush = false;
    this._pendingForce = false;
    settleSync(this, { ok: true });
  }

  async _runCycle(_force = false) {
    const t = speed('sync_cycle');
    this.syncing = true;
    this.pending = false;
    this._forceFlush = _force;

    const gatePath = await getSyncPath().catch(() => '');
    await refreshRustOwnership().catch(() => {});
    if (isRustSyncActive() && !gatePath.startsWith('scoped:')) {
      logger.debug('[sync] rust scheduler active → skip JS cycle');
      t?.end();
      this._resolveSkip();
      return;
    }

    const rustOwnsCloud = isRustSyncActive();

    const { getSettingSync } = await import('@/lib/settings');
    const { bufToBase64 } = await import('@/utils/crypto/codec.js');
    const onboardingCompleted = getSettingSync('onboardingCompleted');
    if (!onboardingCompleted) {
      logger.info('[sync] onboarding not completed → skip cycle');
      t?.end();
      this._resolveSkip();
      return;
    }
    const syncPath = await getSyncPath();
    const activeTransportNames = this.getActiveTransports();
    if (!syncPath && activeTransportNames.includes('local')) {
      logger.info('[sync] no syncPath + local transport → skip cycle');
      t?.end();
      this._resolveSkip();
      return;
    }

    try { emit('sync:status', { status: 'syncing' }); } catch {}

    const isForegroundWake = this._foregroundWake;
    this._foregroundWake = false;
    const pullOnly = this._pullOnlyMode;
    this._pullOnlyMode = false;

    const shouldPull = _force || isForegroundWake || pullOnly || hasPendingWrites();
    const shouldPush = !pullOnly;
    let gotUpdates = false;
    logger.info('[sync] _runCycle start', { force: _force, foregroundWake: isForegroundWake, pullOnly, shouldPull, shouldPush });

    let outcome;
    try {
      const hasLocal = activeTransportNames.includes('local');

      const cloudOnly = activeTransportNames.length === 1 && activeTransportNames[0] === 'cloud';
      setCloudBuffer(cloudOnly ? this.transports.cloud.getCloudBuffer() : null);

      logger.info('[sync] cycle config', { syncPath: syncPath || '(none)', transports: activeTransportNames, hasLocal });

      const { getSyncReadiness } = await import('./readiness.js');
      const readiness = await getSyncReadiness();
      logger.info('[sync] readiness', { isAuth: readiness.isAuth, plan: readiness.plan, syncAllowed: readiness.syncAllowed, keyReady: readiness.keyReady, wsId: readiness.workspaceId });

      if (this.transports.cloud?.setReadiness) {
        this.transports.cloud.setReadiness(readiness);
      }

      if (!readiness.keyReady) {
        logger.info('[sync] encryption key not ready: deferring cycle');
        try { emit('sync:status', { status: 'unlock-required' }); } catch {}
        outcome = { ok: true };
        return;
      }

      {
        const { getDeclinedVaultJoinPath } = await import('@/utils/crypto/encryption.js');
        if (syncPath && getDeclinedVaultJoinPath() === syncPath) {
          logger.info('[sync] vault join declined for this folder: pausing cycle');
          try { emit('sync:status', { status: 'vault-join-required' }); } catch {}
          outcome = { ok: true };
          return;
        }
      }

      {
        let syncPassphrase = null;
        try {
          syncPassphrase = await loadSecureBlob('encryptionPassphraseBlob');
        } catch (e) {
          logger.warn('[sync] loadSecureBlob(encryptionPassphraseBlob) failed:', e?.message || e);
          syncPassphrase = null;
        }
        try {
          await fetchCloudKeyParams();
        } catch (e) {
          logger.warn('[sync] fetchCloudKeyParams failed:', e?.message || e);
        }
        try {
          await reconcileSyncKeyParams(syncPassphrase || undefined);
        } catch (e) {
          logger.warn('[sync] key-params reconcile failed:', e);
        }

      }

      if (syncPath) {
        try {
          const syncDir = path.join(syncPath, SYNC_ROOT_DIR);
          const localDir = await getAppDirectory();
          await syncAssets(localDir, syncDir, (progress) => {
            try { emit('sync:progress', progress); } catch {}
          });
        } catch (err) {
          logger.error('[sync] asset sync failed:', err?.message || err);
        }
      }

      if (hasLocal) {
        await this.transports.local.seedOnce().catch(() => {});
      }
      if (activeTransportNames.includes('cloud')) {
        await this.transports.cloud.seedOnce().catch(() => {});
      }

      await flushPendingSyncWrites();

      let cloudBlocked = false;
      if (shouldPull) {
        try { emit('sync:progress', { phase: 'pull', processed: 0, total: 0 }); } catch {}
        for (const name of activeTransportNames) {
          if (name === 'cloud' && rustOwnsCloud) continue;
          const transport = this.transports[name];
          logger.info(`[sync] ${name} pull start`);
          let hasMore = true;
          let pages = 0;
          const pullAffectedNotes = new Set();
          while (hasMore && pages < MAX_PULL_PAGES) {
            pages++;
            let pullResult;
            try {
              pullResult = await transport.pull();
            } catch (e) {
              logger.warn(`[sync] ${name} pull error:`, e?.code, e?.message);
              if (e?.code === 'unlock-required') {
                logger.warn('[sync] pull deferred: encryption is locked or not configured');
                try { emit('sync:status', { status: 'unlock-required' }); } catch {}
                if (name === 'cloud') cloudBlocked = true;
                break;
              }
              if (e?.code === 'DECRYPT_FAILED') {

                try { emit('sync:status', { status: 'decrypt-failed', message: e.message }); } catch {}
                throw e;
              }
              throw e;
            }
            const { updates } = pullResult;
            logger.info(`[sync] ${name} pull got ${updates.length} updates`);
            const succeeded = Array.from({ length: updates.length }, () => false);

            if (updates.length > 0) {
              let batchApplied = false;
              try {
                const noteIds = [];
                const updateB64s = [];
                const devices = [];
                for (let i = 0; i < updates.length; i++) {
                  noteIds.push(updates[i].noteId);
                  updateB64s.push(bufToBase64(updates[i].update));
                  devices.push(updates[i].device);
                  if (i % APPLY_YIELD_STRIDE === APPLY_YIELD_STRIDE - 1) {
                    await yieldToUi();
                  }
                }
                await appendBatch(noteIds, updateB64s, devices);
                batchApplied = true;
              } catch (batchErr) {
                logger.warn('[sync] batch append failed, falling back to individual:', batchErr?.message);
              }

              if (batchApplied) {
                for (let i = 0; i < updates.length; i++) {
                  try {
                    applyRemote(updates[i].noteId, updates[i].update);
                    succeeded[i] = true;
                  } catch (err) {
                    logger.warn('[sync] pull apply failed:', err?.message);
                  }
                  if (i % APPLY_YIELD_STRIDE === APPLY_YIELD_STRIDE - 1) {
                    await yieldToUi();
                  }
                }
              } else {
                for (let i = 0; i < updates.length; i++) {
                  try {
                    await appendUpdate(updates[i].noteId, updates[i].update, updates[i].device);
                    applyRemote(updates[i].noteId, updates[i].update);
                    succeeded[i] = true;
                  } catch (err) {
                    logger.warn('[sync] pull apply failed:', err?.message);
                  }
                }
              }
            }
            if (updates.length > 0) {
              try { emit('sync:progress', { phase: 'pull', processed: updates.length, total: updates.length }); } catch {}
            }

            if (updates.length > 0) {
              try {
                reconcileUnknownNotePlaceholders(updates.map((u) => u.noteId));
              } catch (err) {
                console.warn('[sync] placeholder reconciliation failed:', err?.message);
              }
            }

            if (updates.length > 0) {
              try {
                const hasMetaUpdates = updates.some((u) => u.noteId === 'meta');
                const affectedIds = updates
                  .filter((u) => u.noteId !== 'meta')
                  .map((u) => u.noteId);
                await writeStoresFromWorkspace(hasMetaUpdates && affectedIds.length === 0 ? null : new Set(affectedIds), {
                  labels: false,
                  labelColors: false,
                  folders: false,
                  deleted: false,
                });
              } catch (err) {
                logger.warn('[sync] store refresh after pull failed:', err?.message);
              }
            }

            const allSucceeded = succeeded.every(Boolean);
            if (allSucceeded) {
              if (updates.length > 0 && hasLocal) {
                const affectedNoteIds = new Set(updates.map((u) => u.noteId));
                for (const noteId of affectedNoteIds) {
                  pullAffectedNotes.add(noteId);
                  try {
                    const sv = await getCurrentStateVector(noteId);
                    if (sv && Object.keys(sv).length > 0) {
                      saveStateVector(noteId, sv);
                    }
                  } catch {}
                }
              } else {
                for (const u of updates) pullAffectedNotes.add(u.noteId);
              }
            } else if (!allSucceeded) {
              hasMore = false;
              break;
            }
            if (updates.length > 0) gotUpdates = true;
            hasMore = pullResult.hasMore === true;
          }

          if (pullAffectedNotes.size > 0) {
            const { compactUpdates } = await import('@/lib/native/yjs.js');
            let compacted = 0;
            for (const noteId of pullAffectedNotes) {
              if (compacted >= 10) break;
              try {
                const doc = getActiveDoc(noteId);
                if (doc) {
                  const state = Y.encodeStateAsUpdate(doc);
                  if (state.byteLength > 0) {
                    await compactUpdates(noteId, state);
                  }
                }
              } catch {

              }
              compacted += 1;
              if (compacted % APPLY_YIELD_STRIDE === 0) {
                await yieldToUi();
              }
            }
          }
        }
      } else {
        logger.info('[sync] pull skipped: nothing to sync');
      }

      if (pullOnly && !gotUpdates && !hasPendingWrites()) {
        this._idlePullBackoff = true;
      }

      let assetsUploaded = 0;
      if (activeTransportNames.includes('cloud') && !cloudBlocked && !rustOwnsCloud) {
        logger.info('[sync] cloud syncAssets start');
        try {
          assetsUploaded = (await this.transports.cloud.syncAssets((progress) => {
            try { emit('sync:progress', progress); } catch {}
          })) ?? 0;
        } catch (err) {
          logger.warn('[sync] cloud asset sync failed:', err?.message);
        }
        logger.info('[sync] cloud syncAssets done', { assetsUploaded });
      }

      let cloudPushThrottled = false;
      if (shouldPush) {
        for (const name of activeTransportNames) {
          if (name === 'cloud' && rustOwnsCloud) continue;
          if (cloudBlocked && name === 'cloud') {
            logger.info('[sync] cloud push skipped: pull deferred due to unlock-required');
            continue;
          }
          const transport = this.transports[name];
          logger.info(`[sync] ${name} push start`);
          let pushResult;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              pushResult = await transport.push({ force: this._forceFlush });
              break;
            } catch (err) {
              if (err?.code === 'unlock-required') throw err;
              if (attempt === 2) throw err;
              try { emit('sync:status', { status: 'retrying' }); } catch {}
            }
          }
          if (name === 'cloud' && pushResult?.throttled) cloudPushThrottled = true;
          logger.info(`[sync] ${name} push done`, { pushed: pushResult.pushed });
        }

        if (assetsUploaded > 0 && cloudPushThrottled && !cloudBlocked) {
          logger.info('[sync] assets uploaded while push throttled: forcing push to notify peer');
          try {
            await this.transports.cloud.push({ force: true });
          } catch (err) {
            logger.warn('[sync] forced asset-notify push failed:', err?.message);
          }
        }
      } else {
        logger.info('[sync] push skipped: pull-only mode');
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
      logger.info('[sync] cycle complete ok');
    } catch (err) {
      logger.error('[sync] Sync failed:', err);
      logger.error('[sync] failed at:', err?.stack?.split('\n')[1]?.trim());
      try { emit('sync:error', { message: err?.message || 'Sync failed' }); } catch {}
      const status = err?.code === 'unlock-required' ? 'unlock-required' :
        err?.status === 401 || err?.status === 403 ? 'authorization-failed' : 'offline';
      try { emit('sync:status', { status }); } catch {}
      outcome = { ok: false, err };
    } finally {
      t?.end();
      settleSync(this, outcome);
      if (this.pending) {
        this.pending = false;
        const pendingForce = this._pendingForce;
        this._pendingForce = false;
        this._runCycle(pendingForce).catch((err) => {
          logger.error('[sync] recursive cycle failed:', err);
        });
      }
    }
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
