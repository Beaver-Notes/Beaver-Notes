import { describe, expect, it, vi, beforeEach } from 'vitest';

const securityBlobs = new Map();
vi.mock('@/lib/native/security', () => ({
  isEncryptionAvailable: vi.fn(async () => true),
  encryptString: vi.fn(async (s) => `enc:${s}`),
  decryptString: vi.fn(async (s) => s.replace(/^enc:/, '')),
  storeSecureBlob: vi.fn(async (k, blob) => securityBlobs.set(k, blob)),
  fetchSecureBlob: vi.fn(async (k) => securityBlobs.get(k) ?? null),
}));
vi.mock('@/lib/api/auth', () => ({
  setKeypair: vi.fn(async () => ({ ok: true })),
}));

describe('identity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('generates a valid ML-KEM-768 keypair', async () => {
    const { generateIdentity } = await import('@/utils/crypto/identity');
    const id = await generateIdentity();
    expect(id.publicKeyHex).toMatch(/^[0-9a-f]{2368}$/i); // 1184 bytes hex
    expect(id.privateKeyHex.length).toBeGreaterThan(0);
  });

  it('loadOrCreateIdentity persists and returns a stable key', async () => {
    const { loadOrCreateIdentity } = await import('@/utils/crypto/identity');
    const first = await loadOrCreateIdentity();
    const second = await loadOrCreateIdentity();
    expect(first.publicKeyHex).toBe(second.publicKeyHex);
  });

  // Regression: the public key must reach the account's own server. Without an
  // explicit baseUrl, setKeypair falls back to DEFAULT_API_URL (production), the
  // device never lands in accounts.deviceKeys, and shared notes open empty.
  it('publishIdentity sends the keypair to the given baseUrl', async () => {
    const { setKeypair } = await import('@/lib/api/auth');
    const { publishIdentity } = await import('@/utils/crypto/identity');
    const identity = { publicKeyHex: 'ab'.repeat(1184), privateKeyHex: 'cd' };
    await publishIdentity(identity, 'device-1', 'http://localhost:4000');
    expect(setKeypair).toHaveBeenCalledWith(identity.publicKeyHex, {
      deviceId: 'device-1',
      baseUrl: 'http://localhost:4000',
    });
  });

  // Two accounts must not be linkable by key: a shared identity would let the
  // server tie both accounts to one device.
  it('gives each account its own keypair and never shares one', async () => {
    const { loadOrCreateIdentity, identityBlobKey } = await import(
      '@/utils/crypto/identity'
    );
    expect(identityBlobKey('a1')).toBe('e2eIdentityKeypair:a1');
    expect(identityBlobKey()).toBe('e2eIdentityKeypair');
    const a = await loadOrCreateIdentity('a1');
    const b = await loadOrCreateIdentity('a2');
    expect(a.publicKeyHex).not.toBe(b.publicKeyHex);
    expect(await loadOrCreateIdentity('a1')).toEqual(a);
  });
});
