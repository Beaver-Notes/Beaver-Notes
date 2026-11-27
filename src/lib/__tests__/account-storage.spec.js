import { describe, expect, it, vi, beforeEach } from 'vitest';

// Stateful blob mock: the per-account rules are about which SLOT a credential
// lands in, so the mock has to remember what was stored, not just swallow it.
const { blobs } = vi.hoisted(() => ({ blobs: new Map() }));

vi.mock('@/lib/native/security', () => ({
  isEncryptionAvailable: vi.fn(async () => true),
  encryptString: vi.fn(async (s) => `cipher:${s}`),
  decryptString: vi.fn(async (s) => s.replace(/^cipher:/, '')),
  storeSecureBlob: vi.fn(async (key, blob) => {
    blobs.set(key, blob);
  }),
  fetchSecureBlob: vi.fn(async (key) => blobs.get(key) ?? null),
  clearSecureBlob: vi.fn(async (key) => {
    blobs.delete(key);
  }),
}));

import {
  saveSessionToken,
  loadSessionToken,
  clearSessionToken,
  saveRefreshToken,
  loadRefreshToken,
  clearRefreshToken,
  saveCachedProfile,
  loadCachedProfile,
  refreshMirrorKey,
  saveAccountDeviceId,
  loadAccountDeviceId,
  clearAllAccountStorage,
} from '@/lib/account-storage';

describe('account-storage session token', () => {
  beforeEach(() => {
    localStorage.clear();
    blobs.clear();
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

describe('account-storage per-account slots', () => {
  beforeEach(() => {
    localStorage.clear();
    blobs.clear();
    vi.clearAllMocks();
  });

  it("keeps two accounts' session tokens apart", async () => {
    await saveSessionToken('token-a1', 'a1');
    await saveSessionToken('token-a2', 'a2');
    expect(await loadSessionToken('a1')).toBe('token-a1');
    expect(await loadSessionToken('a2')).toBe('token-a2');
  });

  it("keeps two accounts' cached profiles apart", async () => {
    await saveCachedProfile({ id: 'a1', email: 'a@test.test' }, 'a1');
    await saveCachedProfile({ id: 'a2', email: 'b@test.test' }, 'a2');
    expect(await loadCachedProfile('a1')).toEqual({ id: 'a1', email: 'a@test.test' });
    expect(await loadCachedProfile('a2')).toEqual({ id: 'a2', email: 'b@test.test' });
  });

  it("clearing one account's refresh token leaves the other intact", async () => {
    await saveRefreshToken('refresh-a1', 'a1');
    await saveRefreshToken('refresh-a2', 'a2');
    await clearRefreshToken('a1');
    expect(await loadRefreshToken('a1')).toBeNull();
    expect(await loadRefreshToken('a2')).toBe('refresh-a2');
  });

  it('clearing a per-account refresh token still removes its mirror', async () => {
    await saveRefreshToken('refresh-a3', 'a3');
    localStorage.setItem(refreshMirrorKey('a3'), 'stale');
    await clearRefreshToken('a3');
    expect(localStorage.getItem(refreshMirrorKey('a3'))).toBeNull();
  });

  it('the pre-migration install-level slot stays independent of the per-account ones', async () => {
    await saveSessionToken('legacy-tok');
    await saveSessionToken('token-a1', 'a1');
    expect(await loadSessionToken()).toBe('legacy-tok');
    expect(await loadSessionToken('a1')).toBe('token-a1');
  });

  it('clearing one account leaves the install device id alone, a full sign-out wipes it', async () => {
    await saveAccountDeviceId('device-1');
    await saveSessionToken('token-a1', 'a1');
    await clearAllAccountStorage('a1');
    expect(await loadAccountDeviceId()).toBe('device-1');
    expect(await loadSessionToken('a1')).toBeNull();
    await clearAllAccountStorage();
    expect(await loadAccountDeviceId()).toBeNull();
  });
});
