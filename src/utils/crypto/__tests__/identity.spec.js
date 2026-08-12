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
});
