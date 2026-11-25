import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../path.js', () => ({ getSyncPath: vi.fn(() => Promise.resolve('')) }));
vi.mock('@/lib/tauri-bridge', () => ({
  path: { join: (...a) => a.join('/') },
  backend: { invoke: vi.fn(() => Promise.resolve('/app')) },
}));
vi.mock('@/lib/native/fs', () => ({
  ensureDir: vi.fn(() => Promise.resolve()),
  writeFile: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/settings', () => ({
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
  useWorkspaceStore: vi.fn(() => ({ activeId: 'ws-123' })),
}));
vi.mock('@/lib/api/types', () => ({
  SYNC_TRANSPORT: { FOLDER: 'folder', REMOTE: 'remote' },
  normalizeSyncTransport: (v) => v === 'remote' ? 'remote' : 'folder',
  canUseCloudSync: () => true,
}));
vi.mock('@/lib/api/client', () => ({
  getApiClient: vi.fn(() => ({
    getAccountVaultKeyParams: vi.fn(),
    getVaultKeyParams: vi.fn(),
    publishAccountVaultKeyParams: vi.fn(),
    publishVaultKeyParams: vi.fn(),
    createVaultChallenge: vi.fn(),
  })),
}));
vi.mock('@/lib/account-storage', () => ({
  loadSessionToken: vi.fn(() => Promise.resolve('test-token')),
}));
vi.mock('@/lib/native/security.js', () => ({
  localKeyParamsJson: vi.fn(() =>
    Promise.resolve('{"version":3,"saltHex":"42424242424242424242424242424242","wrappedKey":{}}')
  ),
}));

import {
  cloudKeyParamsReachable,
  cloudKeyParamsAbsent,
  deriveVaultPassphraseProof,
  fetchCloudKeyParams,
  publishCloudKeyParams,
} from '../vault-key-params.js';
import { writeFile } from '@/lib/native/fs';
import { getSettingSync } from '@/lib/settings';
import { getSyncPath } from '../path.js';
import { getApiClient } from '@/lib/api/client';
import { loadSessionToken } from '@/lib/account-storage';
import { backend } from '@/lib/tauri-bridge';
import { useWorkspaceStore } from '@/store/workspace.ts';

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

describe('vault API payloads', () => {
  afterEach(() => {
    // Restore the module-wide default so later suites keep resolving paths.
    backend.invoke.mockImplementation(() => Promise.resolve('/app'));
  });

  it('derives proofs through the rust bridge, bound to workspace + blob, independent of the challenge', async () => {
    const derive = vi.fn(
      (_channel, { passphrase, workspaceId, keyParamsBlob }) =>
        Promise.resolve(`proof:${passphrase}:${workspaceId}:${keyParamsBlob}`)
    );
    backend.invoke.mockImplementation(derive);

    const first = await deriveVaultPassphraseProof('vault-passphrase', 'ws-a', 'blob-a', 'challenge');
    const second = await deriveVaultPassphraseProof('vault-passphrase', 'ws-a', 'blob-a', 'challenge');
    const differentWorkspace = await deriveVaultPassphraseProof('vault-passphrase', 'ws-b', 'blob-a', 'challenge');
    const differentBlob = await deriveVaultPassphraseProof('vault-passphrase', 'ws-a', 'blob-b', 'challenge');
    const differentChallenge = await deriveVaultPassphraseProof('vault-passphrase', 'ws-a', 'blob-a', 'other-challenge');
    const differentPassphrase = await deriveVaultPassphraseProof('other', 'ws-a', 'blob-a', 'challenge');

    // The proof must be stable across requests so publish and verify can be
    // compared later; the per-request challenge is a freshness token handled
    // by the server, NOT part of derivation.
    expect(first).toBe(second);
    expect(first).toBe(differentChallenge);
    expect(first).not.toBe(differentBlob);
    expect(first).not.toBe(differentWorkspace);
    expect(first).not.toBe(differentPassphrase);

    // Derivation is delegated to the Rust command; the challenge never crosses the bridge.
    expect(backend.invoke).toHaveBeenCalledWith('vault:deriveProof', {
      passphrase: 'vault-passphrase',
      workspaceId: 'ws-a',
      keyParamsBlob: 'blob-a',
    });
  });
});

describe('fetchCloudKeyParams', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes fetched key params into the shared local file without a folder', async () => {
    const manifest = '{"version":3,"saltHex":"42424242424242424242424242424242","wrappedKey":{}}';
    getApiClient.mockReturnValue({
      getAccountVaultKeyParams: vi.fn(() => Promise.resolve({ keyParams: manifest })),
      getVaultKeyParams: vi.fn(() => Promise.resolve({ keyParams: manifest })),
      createVaultChallenge: vi.fn(() => Promise.resolve({ challenge: 'challenge-1' })),
    });
    const ok = await fetchCloudKeyParams();
    expect(ok).toBe(true);
    expect(writeFile).toHaveBeenCalledWith(expect.stringContaining('keyParams.json'), manifest);
  });

  it('refuses to overwrite local key params with a shapeless payload', async () => {
    getApiClient.mockReturnValue({
      getAccountVaultKeyParams: vi.fn(() => Promise.resolve({ keyParams: '{"key":"remote"}' })),
      getVaultKeyParams: vi.fn(() => Promise.resolve({ keyParams: '{"key":"remote"}' })),
      createVaultChallenge: vi.fn(() => Promise.resolve({ challenge: 'challenge-1' })),
    });
    await expect(fetchCloudKeyParams()).resolves.toBeNull();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('returns null when the vault has no key params', async () => {
    getApiClient.mockReturnValue({
      getAccountVaultKeyParams: vi.fn(() => Promise.reject({ status: 404 })),
      getVaultKeyParams: vi.fn(() => Promise.reject({ status: 404 })),
    });
    await expect(fetchCloudKeyParams()).resolves.toBeNull();
  });

  it('does not require a configured sync path', async () => {
    getApiClient.mockReturnValue({
      getAccountVaultKeyParams: vi.fn(() => Promise.resolve({ keyParams: '{"key":"remote"}' })),
      getVaultKeyParams: vi.fn(() => Promise.resolve({ keyParams: '{"key":"remote"}' })),
      createVaultChallenge: vi.fn(() => Promise.resolve({ challenge: 'challenge-1' })),
    });
    await fetchCloudKeyParams();
    expect(getSyncPath).toHaveBeenCalled();
    expect(getApiClient).toHaveBeenCalled();
  });

  it('does not block for the full timeout when no session token exists', async () => {
    loadSessionToken.mockResolvedValue(null);
    const start = Date.now();
    await fetchCloudKeyParams({ timeoutMs: 300 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1500);
  });
});

describe('cloudKeyParamsAbsent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadSessionToken.mockResolvedValue('test-token');
  });

  it('is true only after a clean 404, false once params exist', async () => {
    getApiClient.mockReturnValue({
      getAccountVaultKeyParams: vi.fn(() => Promise.reject({ status: 404 })),
      getVaultKeyParams: vi.fn(() => Promise.reject({ status: 404 })),
    });
    await fetchCloudKeyParams();
    expect(cloudKeyParamsAbsent()).toBe(true);

    getApiClient.mockReturnValue({
      getAccountVaultKeyParams: vi.fn(() =>
        Promise.resolve({ keyParams: '{"version":3,"wrappedKey":{}}' })
      ),
    });
    await fetchCloudKeyParams();
    expect(cloudKeyParamsAbsent()).toBe(false);
  });
});

describe('account-scoped vault key params (Phase 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadSessionToken.mockResolvedValue('test-token');
    useWorkspaceStore.mockReturnValue({ activeId: 'ws-123' });
  });

  it('one account vault key serves every workspace without a per-workspace fetch', async () => {
    const manifest = '{"version":3,"saltHex":"42424242424242424242424242424242","wrappedKey":{}}';
    const accountFetch = vi.fn(() => Promise.resolve({ keyParams: manifest }));
    const workspaceFetch = vi.fn(() => Promise.resolve({ keyParams: manifest }));
    getApiClient.mockReturnValue({
      getAccountVaultKeyParams: accountFetch,
      getVaultKeyParams: workspaceFetch,
    });

    expect(await fetchCloudKeyParams()).toBe(true);
    // Switch the active workspace: the account-scoped params are unchanged, so
    // switching never triggers a vault-key prompt or a per-workspace request.
    useWorkspaceStore.mockReturnValue({ activeId: 'ws-other' });
    expect(await fetchCloudKeyParams()).toBe(true);

    expect(accountFetch).toHaveBeenCalledTimes(2);
    expect(workspaceFetch).not.toHaveBeenCalled();
    expect(writeFile).toHaveBeenLastCalledWith(expect.stringContaining('keyParams.json'), manifest);
  });

  it('falls back to the workspace route when the account route is absent (older server)', async () => {
    const manifest = '{"version":3,"wrappedKey":{}}';
    const workspaceFetch = vi.fn(() => Promise.resolve({ keyParams: manifest }));
    getApiClient.mockReturnValue({
      getAccountVaultKeyParams: vi.fn(() => Promise.reject({ status: 404 })),
      getVaultKeyParams: workspaceFetch,
    });

    expect(await fetchCloudKeyParams()).toBe(true);
    expect(workspaceFetch).toHaveBeenCalledWith('ws-123');
  });
});

describe('publishCloudKeyParams', () => {
  beforeEach(() => vi.clearAllMocks());

  it('publishes the local blob at account scope, with no workspace challenge', async () => {
    const publish = vi.fn(() => Promise.resolve({ ok: true }));
    getApiClient.mockReturnValue({ publishAccountVaultKeyParams: publish });
    const ok = await publishCloudKeyParams();
    expect(ok).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
    const [body] = publish.mock.calls[0];
    expect(body.keyParams).toBeTruthy();
  });

  it('is a no-op when there is no local key params to publish', async () => {
    const publish = vi.fn();
    getApiClient.mockReturnValue({ publishAccountVaultKeyParams: publish });
    const { localKeyParamsJson } = await import('@/lib/native/security.js');
    localKeyParamsJson.mockResolvedValueOnce(null);
    expect(await publishCloudKeyParams()).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });
});
