import { getSyncPath } from './path.js';
import { SYNC_ROOT_DIR } from './constants.js';
import { syncAssets } from './sync-assets.js';
import {
  flushPendingSyncWrites,
  setCloudBuffer,
  setSyncTrigger,
  hasPendingWrites,
} from './pending-writes.js';
import { applyRemote } from '@/composable/useNoteYjs.js';
import { appendUpdate, appendBatch } from '@/lib/native/yjs.js';
import { getAppDirectory, notify } from '@/lib/native/app';
import { backend, path } from '@/lib/tauri-bridge';
import { emit } from '@tauri-apps/api/event';
import { getWorkspaceDoc } from '@/lib/yjs/meta-doc.js';
import { yMapToObj } from '@/lib/yjs/helpers.js';
import { syncDeletedAssets, reconcileUnknownNotePlaceholders, writeStoresFromWorkspace } from '@/lib/yjs/workspace-doc';
import { speed } from '@/utils/speed.js';
import { loadSecureBlob } from '@/utils/crypto/safeStorageBlob.js';
import { fetchCloudKeyParams } from './vault-key-params.js';
import { reconcileSyncKeyParams, syncKeyReady } from '@/lib/native/security.js';
import * as Y from 'yjs';
import { getCurrentStateVector, saveStateVector } from './state-vector.js';
import { getActiveDoc } from '@/lib/yjs/shared.js';
import { logger } from '@/utils/logger';

const PULL_ONLY_INTERVAL_MS = 30_000;

// ── Desktop notifications ──
// Background pull-only cycles can fail or complete every 30s while the app is
// visible, so consecutive failure and lock notifications are throttled to
// avoid spamming the user. Completion notifications only fire when a cycle
// actually moved data.
const ERROR_NOTIFY_THROTTLE_MS = 5 * 60_000;
let lastErrorNotifyAt = 0;
let unlockNotified = false;

async function getAppCopy() {
  try {
    const { useI18nStore } = await import('@/store/i18n');
    return useI18nStore().messages?.app || {};
  } catch {
    return {};
  }
}

function desktopNotify(title, body) {
  if (backend.isTouchRuntime()) return Promise.resolve(false);
  return notify({ title, body }).catch(() => false);
}

function notifySyncCompleted() {
  getAppCopy().then((copy) => {
    desktopNotify('Beaver Notes', copy.syncComplete || 'Sync complete');
  });
}

function notifySyncFailed() {
  const now = Date.now();
  if (now - lastErrorNotifyAt < ERROR_NOTIFY_THROTTLE_MS) return;
  lastErrorNotifyAt = now;
  getAppCopy().then((copy) => {
    desktopNotify('Beaver Notes', copy.syncFailed || 'Sync failed');
  });
}

function notifySyncLocked() {
  if (unlockNotified) return;
  unlockNotified = true;
  getAppCopy().then((copy) => {
    desktopNotify(
      'Beaver Notes',
      copy.syncLockContent ||
        'Sync is encrypted but locked on this device. Unlock it in Settings to resume sync.'
    );
  });
}


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
   *
   * Cloud-only sync relies entirely on WebSocket notifications from
   * Hocuspocus for real-time pull triggers — no polling timer needed.
   * The timer is only started for folder sync which has no notification
   * mechanism.
   */
  startPullTimer() {
    if (this._pullTimer !== null) return;
    const transports = this.getActiveTransports();
    const cloudOnly = transports.length === 1 && transports[0] === 'cloud';
    if (cloudOnly) return;
    this._pullTimer = setInterval(async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (this.syncing) return;
      // Skip entirely when no syncPath is configured and only local transport
      // is active — there is nothing to pull from.
      const syncPath = await getSyncPath();
      const transports = this.getActiveTransports();
      if (!syncPath && transports.length === 1 && transports[0] === 'local') return;
      // Idle backoff: if the previous pull-only cycle found no updates and
      // there is nothing pending locally, skip this tick to avoid pulling the
      // network every 30s for no reason. Detection still resumes on the next
      // tick, so remote changes are picked up at worst one interval later.
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
    this.syncResolve?.();
    this.syncResolve = null;
    this.syncReject = null;
    const waiters = this.pendingWaiters;
    this.pendingWaiters = [];
    for (const { resolve } of waiters) resolve();
  }

  async _runCycle(_force = false) {
    const t = speed('sync_cycle');
    this.syncing = true;
    this.pending = false;
    this._forceFlush = _force;

    // Early exit before any sync work or status emit: with no sync folder and
    // only the local transport active there is nothing to do. Unconfigured
    // installs (no folder, no account) must not pay for cycles on every
    // visibility change / foreground wake / force. `syncing` was already set
    // synchronously so concurrent enqueueSync callers still coalesce.
    const { getSettingSync } = await import('@/lib/settings');
    const { isEncryptionEnabled } = await import('@/utils/crypto/encryption.js');
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
    let pushedAny = false;
    logger.info('[sync] _runCycle start', { force: _force, foregroundWake: isForegroundWake, pullOnly, shouldPull, shouldPush });

    let outcome;
    try {
      const hasLocal = activeTransportNames.includes('local');

      const cloudOnly = activeTransportNames.length === 1 && activeTransportNames[0] === 'cloud';
      setCloudBuffer(cloudOnly ? this.transports.cloud.getCloudBuffer() : null);

      logger.info('[sync] cycle config', { syncPath: syncPath || '(none)', transports: activeTransportNames, hasLocal });

      // Check encryption key readiness before attempting any sync operations.
      // If encryption is enabled but the key hasn't been unlocked yet, all
      // decrypt/encrypt calls would fail with KEY_LOCKED, producing noisy
      // errors and deferred pulls. Skip the cycle gracefully instead.
      if (activeTransportNames.includes('cloud')) {
        const keyReady = await syncKeyReady().catch(() => false);
        const encEnabled = isEncryptionEnabled();
        logger.info('[sync][debug] syncKeyReady:', keyReady, 'isEncryptionEnabled:', encEnabled);
        if (!keyReady && encEnabled) {
          logger.info('[sync] encryption enabled but key not ready — deferring cycle');
          try { emit('sync:status', { status: 'unlock-required' }); } catch {}
          notifySyncLocked();
          outcome = { ok: true };
          return;
        }
      }

      // Vault key params: reconcile on EVERY cycle so a joining device adopts
      // the vault owner's keys as soon as possible.  Previously this only ran
      // on force/foreground cycles, meaning a failed first reconcile left the
      // device using its own local key until the next force sync.
      {
        let syncPassphrase = null;
        try {
          syncPassphrase = await loadSecureBlob('encryptionPassphraseBlob');
        } catch (e) {
          logger.warn('[sync][debug] loadSecureBlob(encryptionPassphraseBlob) failed:', e?.message || e);
          syncPassphrase = null;
        }
        let fetchedRemote = false;
        try {
          const fetched = await fetchCloudKeyParams();
          fetchedRemote = !!fetched;
        } catch (e) {
          logger.warn('[sync][debug] fetchCloudKeyParams failed:', e?.message || e);
        }
        try {
          await reconcileSyncKeyParams(syncPassphrase || undefined);
        } catch (e) {
          logger.warn('[sync] key-params reconcile failed:', e);
        }
        // Never auto-publish key params during reconcile.
        // Key params are published explicitly by:
        //   1. seedCloudOnce – when the first device seeds the vault
        //   2. adoptAndPublishVaultKeyParams – when a joining device adopts
        // Auto-publishing here creates a race: if fetchCloudKeyParams returns
        // 404 (intermittent), the server's existing params get overwritten with
        // this device's local (different) params, breaking decryption for all
        // other devices.
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

      // Only pull when there's a reason: forced sync, foreground wake, or pending local writes.
      // Idle cycles with nothing to push skip the pull to avoid unnecessary network traffic.
      let cloudBlocked = false;
      if (shouldPull) {
        try { emit('sync:progress', { phase: 'pull', processed: 0, total: 0 }); } catch {}
        for (const name of activeTransportNames) {
          const transport = this.transports[name];
          logger.info(`[sync] ${name} pull start`);
          let hasMore = true;
          const pullAffectedNotes = new Set();
          while (hasMore) {
            let pullResult;
            try {
              pullResult = await transport.pull();
            } catch (e) {
              logger.warn(`[sync][debug] ${name} pull error:`, e?.code, e?.message, e);
              if (e?.code === 'unlock-required') {
                logger.warn('[sync] pull deferred — encryption is locked or not configured');
                try { emit('sync:status', { status: 'unlock-required' }); } catch {}
                notifySyncLocked();
                if (name === 'cloud') cloudBlocked = true;
                break;
              }
              if (e?.code === 'DECRYPT_FAILED') {
                // The local key doesn't match the sync data — not a transient
                // lock. Surface it so the user can re-adopt/import the correct
                // vault instead of silently deferring forever.
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
                await appendBatch(
                  updates.map((u) => u.noteId),
                  updates.map((u) => bufToBase64(u.update)),
                  updates.map((u) => u.device)
                );
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

            // Reconcile placeholder meta AFTER the batch's remote updates were
            // applied: notes whose titled meta entries just arrived are already
            // in the workspace doc and keep their titles — only ids still
            // unknown get an untitled placeholder. Must never fail the cycle.
            if (updates.length > 0) {
              try {
                reconcileUnknownNotePlaceholders(updates.map((u) => u.noteId));
              } catch (err) {
                console.warn('[sync] placeholder reconciliation failed:', err?.message);
              }
            }

            // Refresh the Pinia note store when remote meta updates arrive.
            // The workspace-doc observer skips origin 'sync', so applyRemote
            // updates the Y.Doc but never triggers writeStoresFromWorkspace.
            const hasMetaUpdates = updates.some((u) => u.noteId === 'meta');
            if (hasMetaUpdates) {
              try {
                const affectedIds = updates
                  .filter((u) => u.noteId !== 'meta')
                  .map((u) => u.noteId);
                await writeStoresFromWorkspace(affectedIds.length > 0 ? new Set(affectedIds) : null, {
                  labels: false,
                  labelColors: false,
                  folders: false,
                  deleted: false,
                });
              } catch (err) {
                logger.warn('[sync] store refresh after meta update failed:', err?.message);
              }
            }

            const allSucceeded = succeeded.every(Boolean);
            if (allSucceeded) {
              // Save state vectors for affected notes (replaces cursor tracking)
              if (updates.length > 0) {
                const affectedNoteIds = new Set(updates.map((u) => u.noteId));
                for (const noteId of affectedNoteIds) {
                  pullAffectedNotes.add(noteId);
                  try {
                    const sv = await getCurrentStateVector(noteId);
                    if (sv && Object.keys(sv).length > 0) {
                      saveStateVector(noteId, sv);
                    }
                  } catch {
                    // non-critical
                  }
                }
              }
            } else if (!allSucceeded) {
              hasMore = false;
              break;
            }
            if (updates.length > 0) gotUpdates = true;
            hasMore = pullResult.hasMore === true;
          }

          // Compact snapshot cache for notes that received updates.
          // This prevents the staleness check from false-positiving on the
          // newly added rows (which are encrypted re-encryptions of the same
          // content) and avoids an endless bootstrap loop.
          if (pullAffectedNotes.size > 0) {
            const { compactUpdates } = await import('@/lib/native/yjs.js');
            for (const noteId of pullAffectedNotes) {
              try {
                const doc = getActiveDoc(noteId);
                if (doc) {
                  const state = Y.encodeStateAsUpdate(doc);
                  if (state.byteLength > 0) {
                    await compactUpdates(noteId, state);
                  }
                }
              } catch {
                // non-critical — snapshot cache may be stale but sync still works
              }
            }
          }
        }
      } else {
        logger.info('[sync] pull skipped — nothing to sync');
      }

      // After a pull-only cycle with zero remote updates and nothing pending
      // locally, arm the idle backoff so the next timer tick skips the pull.
      if (pullOnly && !gotUpdates && !hasPendingWrites()) {
        this._idlePullBackoff = true;
      }

      if (shouldPush) {
        for (const name of activeTransportNames) {
          if (cloudBlocked && name === 'cloud') {
            logger.info('[sync] cloud push skipped — pull deferred due to unlock-required');
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
          logger.info(`[sync] ${name} push done`, { pushed: pushResult.pushed });
          if (pushResult.pushed > 0) pushedAny = true;
        }
      } else {
        logger.info('[sync] push skipped — pull-only mode');
      }

      if (activeTransportNames.includes('cloud') && !cloudBlocked) {
        logger.info('[sync] cloud syncAssets start');
        await this.transports.cloud.syncAssets((progress) => {
          try { emit('sync:progress', progress); } catch {}
        }).catch((err) => {
          logger.warn('[sync] cloud asset sync failed:', err?.message);
        });
        logger.info('[sync] cloud syncAssets done');
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
      unlockNotified = false;
      if (gotUpdates || pushedAny) notifySyncCompleted();
      logger.info('[sync] cycle complete ok');
    } catch (err) {
      logger.error('[sync] Sync failed:', err);
      logger.error('[sync] failed at:', err?.stack?.split('\n')[1]?.trim());
      try { emit('sync:error', { message: err?.message || 'Sync failed' }); } catch {}
      notifySyncFailed();
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
