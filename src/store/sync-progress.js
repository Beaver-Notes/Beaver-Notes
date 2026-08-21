import { defineStore } from 'pinia';
import { listen } from '@tauri-apps/api/event';
import { notify } from '@/lib/native/app';

const PHASE_MESSAGES = {
  bootstrap: (p) => p.total > 0 ? `Downloading notes (${p.processed}/${p.total})` : 'Downloading notes...',
  pull: (p) => p.total > 0 ? `Pulling updates (${p.processed}/${p.total})` : 'Pulling updates...',
  push: () => 'Pushing updates...',
  presign: () => 'Preparing upload...',
  snapshots: (p) => p.total > 0 ? `Uploading notes (${p.processed}/${p.total})` : 'Uploading notes...',
  assets: (p) => p.total > 0 ? `Syncing assets (${p.processed}/${p.total})` : 'Syncing assets...',
  finalizing: () => 'Finalizing...',
  done: () => 'Sync complete',
};

const STATUS_TAXONOMY = {
  'unlock-required': { tone: 'action', text: 'Notes are locked — unlock to sync' },
  'decrypt-failed': { tone: 'action', text: 'Couldn’t decrypt an update' },
  'authorization-failed': { tone: 'action', text: 'Session expired — sign in again' },
  'workspace-reset': { tone: 'action', text: 'Workspace was reset on the server' },
  retrying: { tone: 'transient', text: 'Retrying…' },
  offline: { tone: 'transient', text: 'Offline — will retry automatically' },
};

export function describeStatus(status, message) {
  const entry = STATUS_TAXONOMY[status];
  if (!entry) return { tone: null, text: '' };
  if (status === 'decrypt-failed') {
    return {
      tone: entry.tone,
      text: message ? `${entry.text} — ${message}` : entry.text,
    };
  }
  return { tone: entry.tone, text: message || entry.text };
}

const NOTIFICATION_THROTTLE_MS = 5 * 60 * 1000;
const lastNotifiedAt = new Map();

function notifyOnce(status, text) {
  const now = Date.now();
  if (now - (lastNotifiedAt.get(status) || 0) < NOTIFICATION_THROTTLE_MS) return;
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
    lastAction: null,
    _unlisten: null,
  }),

  getters: {
    isSyncing: (state) => state.status === 'syncing',
    hasProgress: (state) => state.total > 0 && state.phase !== '',
    phaseMessage: (state) => {
      const fn = PHASE_MESSAGES[state.phase];
      return fn ? fn(state) : state.message || 'Syncing...';
    },
    attention: (state) => {
      if (state.status === 'syncing') return null;
      const described = describeStatus(state.status, state.message);
      if (described.tone) {
        return { tone: described.tone, text: described.text, status: state.status };
      }
      if (state.lastAction) {
        return { tone: state.lastAction.tone ?? 'action', text: state.lastAction.text, status: state.lastAction.status };
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
        this.status = status || 'idle';
        const described = describeStatus(status, event.payload?.message);
        if (described.tone === 'action') {
          this.lastAction = { status, text: described.text, at: Date.now() };
          notifyOnce(status, described.text);
        } else if (status === 'complete' || status === 'syncing') {
          this.lastAction = null;
        }
        if (status === 'complete') {
          this.phase = '';
          this.progress = 0;
          this.total = 0;
          this.processed = 0;
          this.lastAction = null;
        }
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
