import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../path.js', () => ({ getSyncPath: vi.fn(() => Promise.resolve('/sync')) }));
vi.mock('@/lib/tauri-bridge', () => ({ path: { join: (...a) => a.join('/') } }));
vi.mock('@/lib/native/fs', () => ({
  ensureDir: vi.fn(() => Promise.resolve()),
  writeFile: vi.fn(() => Promise.resolve()),
  readData: vi.fn(() => Promise.resolve('eyJrZXkiOiJ2YWx1ZSJ9')),
  pathExists: vi.fn(() => Promise.resolve(true)),
}));
vi.mock('../remote-yjs.js', () => ({
  pushUpdates: vi.fn(() => Promise.resolve({ stored: 1 })),
  pullUpdates: vi.fn(() => Promise.resolve([])),
  fetchUpdate: vi.fn(),
}));
vi.mock('@/composable/settings', () => ({
  getSettingSync: vi.fn(() => 'remote'),
}));
vi.mock('@/store/account', () => ({
  useAccountStore: () => ({ isAuthenticated: true, subscription: { plan: 'pro' } }),
}));
vi.mock('@/lib/api/types', () => ({
  SYNC_TRANSPORT: { FOLDER: 'folder', REMOTE: 'remote', BOTH: 'both' },
  canUseCloudSync: () => true,
}));

import {
  cloudKeyParamsReachable,
  publishCloudKeyParams,
  fetchCloudKeyParams,
  RESERVED_KEY_PARAMS_KEY,
} from '../vault-key-params.js';
import { fetchUpdate, pushUpdates, pullUpdates } from '../remote-yjs.js';
import { writeFile, readData } from '@/lib/native/fs';
import { getSettingSync } from '@/composable/settings';

describe('cloudKeyParamsReachable', () => {
  it('is true when authed, paid, and transport wants cloud', () => {
    expect(cloudKeyParamsReachable()).toBe(true);
  });

  it('is forced true even when transport is folder-only', () => {
    getSettingSync.mockReturnValue('folder');
    expect(cloudKeyParamsReachable()).toBe(false);
    expect(cloudKeyParamsReachable({ force: true })).toBe(true);
    getSettingSync.mockReturnValue('remote');
  });
});

describe('publishCloudKeyParams', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pushes the folder keyParams file as the reserved key', async () => {
    const ok = await publishCloudKeyParams();
    expect(ok).toBe(true);
    expect(readData).toHaveBeenCalledWith('/sync/BeaverNotesSync/keyParams.json');
    expect(pushUpdates).toHaveBeenCalledWith([
      { key: RESERVED_KEY_PARAMS_KEY, data: 'eyJrZXkiOiJ2YWx1ZSJ9' },
    ]);
  });
});

describe('fetchCloudKeyParams', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes the fetched blob into the folder and returns true', async () => {
    fetchUpdate.mockResolvedValue('eyJrZXkiOiJ2YWx1ZSJ9');
    const ok = await fetchCloudKeyParams();
    expect(ok).toBe(true);
    expect(writeFile).toHaveBeenCalledWith('/sync/BeaverNotesSync/keyParams.json', '{"key":"value"}');
  });

  it('falls back to a pull scan when the GET fails', async () => {
    fetchUpdate.mockRejectedValue(new Error('boom'));
    pullUpdates.mockResolvedValue([{ key: RESERVED_KEY_PARAMS_KEY, data: 'eyJrZXkiOiJ2YWx1ZSJ9' }]);
    const ok = await fetchCloudKeyParams();
    expect(ok).toBe(true);
    expect(writeFile).toHaveBeenCalledWith('/sync/BeaverNotesSync/keyParams.json', '{"key":"value"}');
  });

  it('returns null when no blob exists', async () => {
    fetchUpdate.mockResolvedValue(null);
    pullUpdates.mockResolvedValue([]);
    await expect(fetchCloudKeyParams()).resolves.toBeNull();
  });
});
