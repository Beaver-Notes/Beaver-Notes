import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => ({ kickRustSync: vi.fn() }));

vi.mock('@/utils/sync/rust-shim.js', () => ({
  kickRustSync: mocks.kickRustSync,
  startRustSync: vi.fn(),
  kickRustDirty: vi.fn(),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock('@/lib/native/app', () => ({ notify: vi.fn(() => Promise.resolve()) }));
vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({
    translations: {
      value: {
        settings: {
          lastAttemptFailed: 'Last attempt failed',
          neverSynced: 'Never synced yet',
          syncedJustNow: 'Synced just now',
          syncedMinAgo: 'Synced {n} min ago',
        },
      },
    },
  }),
}));

import { useSyncControl } from '../useSyncControl';
import { useSyncProgressStore } from '@/store/sync-progress';

describe('useSyncControl', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mocks.kickRustSync.mockReset();
  });

  it('starts a sync through the rust shim', () => {
    const { syncNow } = useSyncControl();
    syncNow();
    expect(mocks.kickRustSync).toHaveBeenCalledTimes(1);
  });

  it('ignores re-entry while a sync is already running', () => {
    const store = useSyncProgressStore();
    store.status = 'syncing';
    const { syncNow } = useSyncControl();
    syncNow();
    expect(mocks.kickRustSync).not.toHaveBeenCalled();
  });

  it('labels a recent successful sync', () => {
    const store = useSyncProgressStore();
    store.lastSyncAt = Date.now();
    const { lastSyncLabel } = useSyncControl();
    expect(lastSyncLabel.value).toBe('Synced just now');
  });

  it('labels a failed last attempt', () => {
    const store = useSyncProgressStore();
    store.lastAction = {
      status: 'sync-failed',
      text: 'Sync stopped unexpectedly',
      at: Date.now(),
    };
    const { lastSyncLabel } = useSyncControl();
    expect(lastSyncLabel.value).toBe('Last attempt failed');
  });
});
