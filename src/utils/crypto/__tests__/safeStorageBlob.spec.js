import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(async () => true),
  encryptString: vi.fn(async (s) => `cipher:${s}`),
  decryptString: vi.fn(async (s) => s.replace(/^cipher:/, '')),
  storeSecureBlob: vi.fn(async () => {}),
  fetchSecureBlob: vi.fn(async () => null),
  clearSecureBlob: vi.fn(async () => {}),
}));

vi.mock('@/lib/native/security', () => mocks);

import { storeSecureBlob } from '@/utils/crypto/safeStorageBlob.js';

describe('safeStorageBlob availability gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isEncryptionAvailable.mockResolvedValue(true);
  });

  it('skips persistence when secure storage is unavailable', async () => {
    mocks.isEncryptionAvailable.mockResolvedValue(false);
    await storeSecureBlob('k', 'v');
    expect(mocks.encryptString).not.toHaveBeenCalled();
    expect(mocks.storeSecureBlob).not.toHaveBeenCalled();
  });

  it('persists when available', async () => {
    await storeSecureBlob('k', 'v');
    expect(mocks.encryptString).toHaveBeenCalledWith('v');
    expect(mocks.storeSecureBlob).toHaveBeenCalledWith('k', 'cipher:v');
  });

  it('consults the backend availability probe', async () => {
    await storeSecureBlob('k', 'v');
    expect(mocks.isEncryptionAvailable).toHaveBeenCalled();
  });
});
