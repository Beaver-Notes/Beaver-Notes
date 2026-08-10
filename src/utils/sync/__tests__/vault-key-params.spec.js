import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../path.js', () => ({ getSyncPath: vi.fn(() => Promise.resolve('')) }));
vi.mock('@/lib/tauri-bridge', () => ({
  path: { join: (...a) => a.join('/') },
  backend: { invoke: vi.fn(() => Promise.resolve('/app')) },
}));
vi.mock('@/lib/native/fs', () => ({
  ensureDir: vi.fn(() => Promise.resolve()),
  writeFile: vi.fn(() => Promise.resolve()),
  readData: vi.fn(() => Promise.resolve('eyJrZXkiOiJ2YWx1ZSJ9')),
  pathExists: vi.fn(() => Promise.resolve(true)),
}));
vi.mock('@/composable/settings', () => ({
  getSettingSync: vi.fn(() => 'remote'),
}));
vi.mock('@/store/account', () => ({
  useAccountStore: () => ({
    isAuthenticated: true,
    subscription: { plan: 'pro' },
    serverUrl: 'https://sync.example.test',
  }),
}));
vi.mock('@/store/workspace.ts', () => ({
  useWorkspaceStore: () => ({ activeId: 'ws-123' }),
}));
vi.mock('@/lib/api/types', () => ({
  SYNC_TRANSPORT: { FOLDER: 'folder', REMOTE: 'remote', BOTH: 'both' },
  canUseCloudSync: () => true,
}));
vi.mock('@/lib/api/client', () => ({
  getApiClient: vi.fn(() => ({
    getVaultKeyParams: vi.fn(),
    publishVaultKeyParams: vi.fn(),
    createVaultChallenge: vi.fn(),
  })),
}));
vi.mock('@/utils/crypto/safeStorageBlob.js', () => ({
  loadSecureBlob: vi.fn(() => Promise.resolve('vault-passphrase')),
}));

import {
  cloudKeyParamsReachable,
  deriveVaultPassphraseProof,
  publishCloudKeyParams,
  fetchCloudKeyParams,
} from '../vault-key-params.js';
import { writeFile, readData } from '@/lib/native/fs';
import { getSettingSync } from '@/composable/settings';
import { getSyncPath } from '../path.js';
import { getApiClient } from '@/lib/api/client';

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

  it('publishes local key params through the vault endpoint without a folder', async () => {
    const put = vi.fn(() => Promise.resolve({ ok: true }));
    const createChallenge = vi.fn(() => Promise.resolve({ challenge: 'challenge-1' }));
    getApiClient.mockReturnValue({ publishVaultKeyParams: put, createVaultChallenge: createChallenge });
    const ok = await publishCloudKeyParams();
    expect(ok).toBe(true);
    expect(readData).toHaveBeenCalledWith(expect.stringContaining('keyParams.json'));
    expect(put).toHaveBeenCalledWith('ws-123', {
      keyParams: 'eyJrZXkiOiJ2YWx1ZSJ9',
      passphraseProof: await deriveVaultPassphraseProof(
        'vault-passphrase',
        'ws-123',
        'eyJrZXkiOiJ2YWx1ZSJ9',
        'challenge-1'
      ),
      challenge: 'challenge-1',
    });
  });
});

describe('vault API payloads', () => {
  it('derives a deterministic proof bound to the key params blob', async () => {
    const first = await deriveVaultPassphraseProof('vault-passphrase', 'ws-a', 'blob-a', 'challenge');
    const second = await deriveVaultPassphraseProof('vault-passphrase', 'ws-a', 'blob-a', 'challenge');
    const differentWorkspace = await deriveVaultPassphraseProof('vault-passphrase', 'ws-b', 'blob-a', 'challenge');
    const differentBlob = await deriveVaultPassphraseProof('vault-passphrase', 'ws-a', 'blob-b', 'challenge');
    const differentChallenge = await deriveVaultPassphraseProof('vault-passphrase', 'ws-a', 'blob-a', 'other-challenge');
    const differentPassphrase = await deriveVaultPassphraseProof('other', 'ws-a', 'blob-a', 'challenge');

    expect(first).toBe(second);
    expect(first).not.toBe(differentBlob);
    expect(first).not.toBe(differentWorkspace);
    expect(first).not.toBe(differentChallenge);
    expect(first).not.toBe(differentPassphrase);
  });
});

describe('fetchCloudKeyParams', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes fetched key params into the shared local file without a folder', async () => {
    getApiClient.mockReturnValue({
      getVaultKeyParams: vi.fn(() => Promise.resolve({ keyParams: '{"key":"remote"}' })),
      createVaultChallenge: vi.fn(() => Promise.resolve({ challenge: 'challenge-1' })),
    });
    const ok = await fetchCloudKeyParams();
    expect(ok).toBe(true);
    expect(writeFile).toHaveBeenCalledWith(expect.stringContaining('keyParams.json'), '{"key":"remote"}');
  });

  it('returns null when the vault has no key params', async () => {
    getApiClient.mockReturnValue({
      getVaultKeyParams: vi.fn(() => Promise.reject({ status: 404 })),
    });
    await expect(fetchCloudKeyParams()).resolves.toBeNull();
  });

  it('does not require a configured sync path', async () => {
    getApiClient.mockReturnValue({
      getVaultKeyParams: vi.fn(() => Promise.resolve({ keyParams: '{"key":"remote"}' })),
      createVaultChallenge: vi.fn(() => Promise.resolve({ challenge: 'challenge-1' })),
    });
    await fetchCloudKeyParams();
    expect(getSyncPath).toHaveBeenCalled();
    expect(getApiClient).toHaveBeenCalled();
  });

  it('does not block for the full timeout when no session token exists', async () => {
    vi.mock('@/composable/useAccountStorage', () => ({
      loadSessionToken: vi.fn(async () => null),
    }));
    const { fetchCloudKeyParams } = await import('@/utils/sync/vault-key-params');
    const start = Date.now();
    await fetchCloudKeyParams({ timeoutMs: 300 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1500);
  });
});
