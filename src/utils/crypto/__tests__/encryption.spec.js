import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/native/security.js', () => ({
  adoptKeyParams: vi.fn(),
  hasRemoteKeyParams: vi.fn(),
  getEncryptionState: vi.fn(() => Promise.resolve({ enabled: true, unlocked: true })),
  submitEncryptionPassword: vi.fn(),
  syncEncryptPayload: vi.fn(),
  syncDecryptPayload: vi.fn(),
  syncKeyReady: vi.fn(),
}));

vi.mock('@/utils/crypto/safeStorageBlob.js', () => ({
  loadSecureBlob: vi.fn(() => Promise.resolve(null)),
  persistSecureBlobInBackground: vi.fn(),
}));

vi.mock('@/utils/sync/vault-key-params.js', () => ({
  publishCloudKeyParams: vi.fn(() => Promise.resolve(false)),
}));

import { adoptVaultKey, hasRemoteVaultKeyParams } from '@/utils/crypto/encryption.js';
import { adoptKeyParams, hasRemoteKeyParams } from '@/lib/native/security.js';

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
});
