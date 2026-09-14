import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/native/security.js', () => ({
  adoptKeyParams: vi.fn(),
  hasRemoteKeyParams: vi.fn(),
  getEncryptionState: vi.fn(() => Promise.resolve({ enabled: true, unlocked: true })),
  submitEncryptionPassword: vi.fn(),
  reconcileSyncKeyParams: vi.fn(() => Promise.resolve()),
  syncEncryptPayload: vi.fn(),
  syncDecryptPayload: vi.fn(),
  syncKeyReady: vi.fn(),
  localKeyParamsJson: vi.fn(() => Promise.resolve(null)),
  remoteParamsDiffer: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@/utils/crypto/safeStorageBlob.js', () => ({
  loadSecureBlob: vi.fn(() => Promise.resolve(null)),
  persistSecureBlobInBackground: vi.fn(),
}));

vi.mock('@/utils/sync/vault-key-params.js', () => ({
  fetchCloudKeyParams: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('@/lib/tauri/scoped-storage.js', () => ({
  kickSyncDir: vi.fn(),
}));

vi.mock('@/utils/sync/path.js', () => ({
  getSyncPath: vi.fn(() => Promise.resolve('')),
  setSyncPath: vi.fn(),
}));

vi.mock('@/lib/native/fs', () => ({
  readFile: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('@/lib/tauri-bridge', () => ({
  path: { join: (...parts) => parts.join('/') },
}));

vi.mock('@/lib/settings', () => ({
  getSettingSync: vi.fn(() => null),
  setSetting: vi.fn(async () => {}),
}));

import {
  adoptVaultKey,
  ensureKeyReadyForWrite,
  hasRemoteVaultKeyParams,
  setupEncryption,
  verifyPassphrase,
} from '@/utils/crypto/encryption.js';
import { adoptKeyParams, hasRemoteKeyParams, getEncryptionState, submitEncryptionPassword } from '@/lib/native/security.js';
import { getSettingSync } from '@/lib/settings';
import { getSyncPath } from '@/utils/sync/path.js';
import { fetchCloudKeyParams } from '@/utils/sync/vault-key-params.js';

describe('adoptVaultKey', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns ok on success and reflects the backend state', async () => {
    adoptKeyParams.mockResolvedValue({ ok: true, state: { enabled: true, unlocked: true } });
    const res = await adoptVaultKey('the-vault-passphrase');
    expect(adoptKeyParams).toHaveBeenCalledWith('the-vault-passphrase');
    expect(res.ok).toBe(true);
  });

  it('surfaces backend errors', async () => {
    adoptKeyParams.mockResolvedValue({ ok: false, error: 'WrongPassword' });
    const res = await adoptVaultKey('wrong');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('WrongPassword');
  });

  it('rejects empty passphrases without calling the backend', async () => {
    const res = await adoptVaultKey('   ');
    expect(adoptKeyParams).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
  });
});

describe('hasRemoteVaultKeyParams', () => {
  it('delegates to the native command', async () => {
    hasRemoteKeyParams.mockResolvedValue(true);
    await expect(hasRemoteVaultKeyParams()).resolves.toBe(true);
    expect(hasRemoteKeyParams).toHaveBeenCalled();
  });

  it('kicks off scoped-folder downloads before reading so evicted vaults are seen', async () => {
    const { getSyncPath } = await import('@/utils/sync/path.js');
    const { readFile } = await import('@/lib/native/fs');
    const { kickSyncDir } = await import('@/lib/tauri/scoped-storage.js');
    getSyncPath.mockResolvedValue('scoped:abc');
    readFile.mockResolvedValue('{"version":3}');

    await expect(hasRemoteVaultKeyParams()).resolves.toBe(true);
    expect(kickSyncDir).toHaveBeenCalledWith('scoped:abc');
    expect(hasRemoteKeyParams).not.toHaveBeenCalled();
  });
});

describe('cloud key params on encryption lifecycle', () => {
  beforeEach(() => vi.clearAllMocks());

  // setup/verify must fetch server params (so reconcile adopts the vault
  // owner's keys) but NEVER publish: publishing here could overwrite the
  // owner's keys with this device's fresh key.
  it('fetches server key params and does not auto-publish after setupEncryption', async () => {
    submitEncryptionPassword.mockResolvedValue({ ok: true, state: { enabled: true, unlocked: true } });
    const res = await setupEncryption('a-passphrase');
    expect(res.ok).toBe(true);
    await vi.waitFor(() => expect(fetchCloudKeyParams).toHaveBeenCalled());
  });

  it('fetches server key params and does not auto-publish after verifyPassphrase', async () => {
    submitEncryptionPassword.mockResolvedValue({ ok: true, state: { enabled: true, unlocked: true } });
    const res = await verifyPassphrase('a-passphrase');
    expect(res.ok).toBe(true);
    await vi.waitFor(() => expect(fetchCloudKeyParams).toHaveBeenCalled());
  });
});

describe('ensureKeyReadyForWrite vault-join guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSyncPath.mockResolvedValue('');
    getSettingSync.mockReturnValue(null);
  });

  // A joining device that writes before adopting would mint a random vault
  // and fork away from the shared one: block the mint until the user joins
  // the remote vault or explicitly declines it for this folder.
  it('auto-mints a fresh vault when no remote vault exists', async () => {
    getEncryptionState.mockResolvedValue({ enabled: false, unlocked: false });
    hasRemoteKeyParams.mockResolvedValue(false);
    submitEncryptionPassword.mockResolvedValue({ ok: true, state: { enabled: true, unlocked: true } });

    await expect(ensureKeyReadyForWrite()).resolves.toBe(true);
    expect(submitEncryptionPassword).toHaveBeenCalled();
  });

  it('blocks auto-mint when a remote vault waits to be joined', async () => {
    getEncryptionState.mockResolvedValue({ enabled: false, unlocked: false });
    hasRemoteKeyParams.mockResolvedValue(true);
    getSyncPath.mockResolvedValue('/sync');

    await expect(ensureKeyReadyForWrite()).rejects.toThrow(/vault/i);
    expect(submitEncryptionPassword).not.toHaveBeenCalled();
  });

  it('mints when the remote vault was declined for this folder', async () => {
    getEncryptionState.mockResolvedValue({ enabled: false, unlocked: false });
    hasRemoteKeyParams.mockResolvedValue(true);
    getSyncPath.mockResolvedValue('/sync');
    getSettingSync.mockReturnValue('/sync');
    submitEncryptionPassword.mockResolvedValue({ ok: true, state: { enabled: true, unlocked: true } });

    await expect(ensureKeyReadyForWrite()).resolves.toBe(true);
    expect(submitEncryptionPassword).toHaveBeenCalled();
  });

  it('blocks when declined for a different folder', async () => {
    getEncryptionState.mockResolvedValue({ enabled: false, unlocked: false });
    hasRemoteKeyParams.mockResolvedValue(true);
    getSyncPath.mockResolvedValue('/sync');
    getSettingSync.mockReturnValue('/other');

    await expect(ensureKeyReadyForWrite()).rejects.toThrow(/vault/i);
    expect(submitEncryptionPassword).not.toHaveBeenCalled();
  });
});
