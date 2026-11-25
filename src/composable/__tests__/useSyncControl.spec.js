import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => ({
  kickRustSync: vi.fn(),
  initAppSync: vi.fn(() => Promise.resolve()),
  wsStart: vi.fn(),
  isIOSNetworkUnlocked: vi.fn(() => true),
  unlockIOSNetwork: vi.fn(),
  isIOSRuntime: vi.fn(() => false),
}));

vi.mock('@/utils/sync/rust-shim.js', () => ({
  kickRustSync: mocks.kickRustSync,
  startRustSync: vi.fn(),
  kickRustDirty: vi.fn(),
}));
vi.mock('@/utils/sync/app-sync.js', () => ({
  initAppSync: mocks.initAppSync,
}));
vi.mock('@/lib/sync/ws-sync.js', () => ({
  getWsSync: () => ({ start: mocks.wsStart }),
  isIOSNetworkUnlocked: mocks.isIOSNetworkUnlocked,
  unlockIOSNetwork: mocks.unlockIOSNetwork,
}));
vi.mock('@/lib/tauri-bridge', () => ({
  backend: { isIOSRuntime: mocks.isIOSRuntime },
}));
vi.mock('@/composable/useCloudWorkspaces', () => ({
  useCloudWorkspaces: () => ({ fetchWorkspaces: vi.fn() }),
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
    mocks.initAppSync.mockReset().mockResolvedValue(undefined);
    mocks.wsStart.mockReset();
    mocks.isIOSNetworkUnlocked.mockReset().mockReturnValue(true);
    mocks.unlockIOSNetwork.mockReset();
    mocks.isIOSRuntime.mockReset().mockReturnValue(false);
  });

  it('starts a sync through the rust shim', async () => {
    const { syncNow } = useSyncControl();
    await syncNow();
    expect(mocks.kickRustSync).toHaveBeenCalledTimes(1);
  });

  it('ignores re-entry while a sync is already running', () => {
    const store = useSyncProgressStore();
    store.status = 'syncing';
    const { syncNow } = useSyncControl();
    syncNow();
    expect(mocks.kickRustSync).not.toHaveBeenCalled();
  });

  
  });
