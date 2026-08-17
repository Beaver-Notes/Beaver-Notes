import { defineStore } from 'pinia';
import { listen } from '@tauri-apps/api/event';

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

export const useSyncProgressStore = defineStore('syncProgress', {
  state: () => ({
    status: 'idle',
    phase: '',
    message: '',
    progress: 0,
    total: 0,
    processed: 0,
    _unlisten: null,
  }),

  getters: {
    isSyncing: (state) => state.status === 'syncing',
    hasProgress: (state) => state.total > 0 && state.phase !== '',
    phaseMessage: (state) => {
      const fn = PHASE_MESSAGES[state.phase];
      return fn ? fn(state) : state.message || 'Syncing...';
    },
  },

  actions: {
    startListening() {
      if (this._unlisten) return;

      const unlistenStatus = listen('sync:status', (event) => {
        const { status } = event.payload || {};
        this.status = status || 'idle';
        if (status === 'complete') {
          this.phase = '';
          this.progress = 0;
          this.total = 0;
          this.processed = 0;
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
