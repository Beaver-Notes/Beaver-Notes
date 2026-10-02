import { defineStore } from 'pinia';
import { listen } from '@tauri-apps/api/event';
import { notify } from '@/lib/native/app';

const PHASE_MESSAGES = {
  bootstrap: (p) =>
    p.total > 0
      ? `Downloading notes (${p.processed}/${p.total})`
      : 'Downloading notes...',
  pull: (p) =>
    p.total > 0
      ? `Pulling updates (${p.processed}/${p.total})`
      : 'Pulling updates...',
  push: () => 'Pushing updates...',
  presign: () => 'Preparing upload...',
  snapshots: (p) =>
    p.total > 0
      ? `Uploading notes (${p.processed}/${p.total})`
      : 'Uploading notes...',
  assets: (p) =>
    p.total > 0
      ? `Syncing assets (${p.processed}/${p.total})`
      : 'Syncing assets...',
  finalizing: () => 'Finalizing...',
  done: () => 'Sync complete',
};

const STATUS_TAXONOMY = {
  'unlock-required': {
    tone: 'action',
    text: 'Notes are locked. Unlock to sync.',
  },
  'decrypt-failed': { tone: 'action', text: 'Couldn’t decrypt an update' },
  'item-too-large': {
    tone: 'action',
    text: 'An update is too large to sync. Reduce the change and sync again.',
  },
  'authorization-failed': {
    tone: 'action',
    text: 'Session expired. Sign in again.',
  },
  'workspace-reset': {
    tone: 'action',
    text: 'Workspace was reset on the server',
  },
  'plan-upgrade-required': {
    tone: 'action',
    text: 'Upgrade required to sync this workspace',
  },
  'sync-failed': { tone: 'action', text: 'Sync stopped unexpectedly' },
  retrying: { tone: 'transient', text: 'Retrying…' },
  offline: {
    tone: 'transient',
    text: 'Offline — changes are saved here and will sync later',
  },
  'pending-icloud': {
    tone: 'transient',
    text: 'Waiting for iCloud to finish downloading files…',
  },
  throttled: { tone: 'transient', text: 'Server is busy — retrying shortly' },
};

const LAST_SYNC_KEY = 'sync:lastRunAt';

function readLastSyncAt() {
  try {
    return Number(localStorage.getItem(LAST_SYNC_KEY) || 0);
  } catch {
    return 0;
  }
}

// The Rust engine reports a free-plan 402 as a fatal `sync:error` string
// (`status 402 Payment Required`) rather than a typed status; recognize both
// that and the server's `plan_upgrade_required` body either way.
export function isPlanUpgradeRequired(message) {
  if (typeof message !== 'string') return false;
  return /plan_upgrade_required|plan[- ]upgrade[- ]required/i.test(message) || /\b402\b/.test(message);
}

export function describeStatus(status, message) {
  const entry = STATUS_TAXONOMY[status];
  if (!entry) return { tone: null, text: '' };
  if (status === 'decrypt-failed') {
    return {
      tone: entry.tone,
      text: message ? `${entry.text}: ${message}` : entry.text,
    };
  }
  return { tone: entry.tone, text: message || entry.text };
}

const NOTIFICATION_THROTTLE_MS = 5 * 60 * 1000;
const lastNotifiedAt = new Map();

function notifyOnce(status, text) {
  const now = Date.now();
  if (now - (lastNotifiedAt.get(status) || 0) < NOTIFICATION_THROTTLE_MS)
    return;
  lastNotifiedAt.set(status, now);
  notify({ title: 'Sync needs attention', body: text }).catch(() => {});
}

export const useSyncProgressStore = defineStore('syncProgress', {
  state: () => ({
    status: 'idle',
    phase: '',
    message: '',
    progress: 0,
    total: 0,
    processed: 0,
    lastSyncAt: readLastSyncAt(),
    lastAction: null,
    _unlisten: null,
  }),

  getters: {
    isSyncing: (state) => state.status === 'syncing',
    lastAttemptFailed: (state) => state.lastAction?.status === 'sync-failed',
    hasProgress: (state) => state.total > 0 && state.phase !== '',
    phaseMessage: (state) => {
      const fn = PHASE_MESSAGES[state.phase];
      return fn ? fn(state) : state.message || 'Syncing...';
    },
    attention: (state) => {
      if (state.lastAction) {
        return {
          tone: state.lastAction.tone ?? 'action',
          text: state.lastAction.text,
          status: state.lastAction.status,
          detail: state.lastAction.detail,
        };
      }
      const described = describeStatus(state.status, state.message);
      if (described.tone) {
        return {
          tone: described.tone,
          text: described.text,
          status: state.status,
        };
      }
      return null;
    },
  },

  actions: {
    dismissError() {
      this.lastAction = null;
    },

    startListening() {
      if (this._unlisten) return;

      const unlistenStatus = listen('sync:status', (event) => {
        const { status } = event.payload || {};
        // A plan block is terminal until the user upgrades; the engine's next
        // futile tick emits "syncing" again, which would re-arm the spinner.
        if (status === 'syncing' && this.lastAction?.status === 'plan-upgrade-required') return;
        this.status = status || 'idle';
        const described = describeStatus(status, event.payload?.message);
        if (described.tone === 'action') {
          this.lastAction = { status, text: described.text, at: Date.now() };
          notifyOnce(status, described.text);
        } else if (status === 'complete') {
          // A finished cycle resolves any earlier lock/decrypt/auth warning.
          this.lastAction = null;
          this.lastSyncAt = Date.now();
          try {
            localStorage.setItem(LAST_SYNC_KEY, String(this.lastSyncAt));
          } catch {
            // localStorage unavailable: keep the in-memory timestamp only.
          }
        }
        if (status !== 'syncing') {
          this.phase = '';
          this.progress = 0;
          this.total = 0;
          this.processed = 0;
        }
      });

      const unlistenError = listen('sync:error', (event) => {
        const raw = event.payload?.message;
        const planUpgrade = isPlanUpgradeRequired(raw);
        const status = planUpgrade ? 'plan-upgrade-required' : 'sync-failed';
        const described = describeStatus(status);
        this.status = status;
        this.lastAction = {
          status,
          text: described.text,
          // Keep the engine's raw string behind the banner's "Details" only for
          // the unmapped fallback; the plan block stays as it was.
          detail: planUpgrade ? undefined : raw || '',
          at: Date.now(),
        };
        this.phase = '';
        this.progress = 0;
        this.total = 0;
        this.processed = 0;
        notifyOnce(status, described.text);
      });

      const unlistenProgress = listen('sync:progress', (event) => {
        const { phase, processed, total } = event.payload || {};
        if (phase) this.phase = phase;
        if (total > 0) {
          this.total = total;
          this.processed = processed || 0;
          this.progress = Math.min(100, Math.floor((processed / total) * 100));
        }
      });

      this._unlisten = () => {
        unlistenStatus.then((fn) => fn());
        unlistenError.then((fn) => fn());
        unlistenProgress.then((fn) => fn());
      };
    },

    stopListening() {
      if (this._unlisten) {
        this._unlisten();
        this._unlisten = null;
      }
    },
  },
});
