import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/native/security', () => ({
  isEncryptionAvailable: vi.fn(async () => true),
  encryptString: vi.fn(async (s) => `cipher:${s}`),
  decryptString: vi.fn(async (s) => s.replace(/^cipher:/, '')),
  storeSecureBlob: vi.fn(async () => {}),
  fetchSecureBlob: vi.fn(async () => null),
  clearSecureBlob: vi.fn(async () => {}),
}));

import {
  saveSessionToken,
  loadSessionToken,
  clearSessionToken,
} from '@/lib/account-storage';

describe('account-storage session token', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('never writes a plaintext _plain localStorage key', async () => {
    await saveSessionToken('tok-123');
    const plain = localStorage.getItem('beaverAccountSession_plain');
    expect(plain).toBeNull();
    const cipher = localStorage.getItem('beaverAccountSession');
    expect(cipher).not.toBeNull();
  });

  it('round-trips through the encrypted mirror', async () => {
    await saveSessionToken('tok-123');
    const token = await loadSessionToken();
    expect(token).toBe('tok-123');
  });

  it('clears the encrypted mirror on clearSessionToken', async () => {
    await saveSessionToken('tok-123');
    await clearSessionToken();
    expect(localStorage.getItem('beaverAccountSession')).toBeNull();
  });
});
