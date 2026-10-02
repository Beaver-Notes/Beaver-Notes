import { describe, test, expect, vi } from 'vitest';

// Fail-closed envelope guard: plaintext must never parse as sync data.
// Mirrors snapshot-bytetype.spec.js mock style for the Rust crypto bridge.
vi.mock('@/utils/crypto/encryption.js', () => ({ isEncryptionEnabled: () => true }));
vi.mock('@/lib/native/security.js', () => ({
  syncEncryptPayload: vi.fn(),
  syncDecryptPayload: vi.fn(),
  syncDecryptBatch: vi.fn(),
  syncKeyReady: () => Promise.resolve(true),
}));

const { decryptJSON } = await import('@/utils/sync/crypto.js');

describe('fail-closed envelope', () => {
  test('rejects plaintext passthrough', async () => {
    await expect(decryptJSON('{"hello":"world"}')).rejects.toThrow(
      'sync: non-envelope payload rejected'
    );
  });

  test('rejects non-string input', async () => {
    await expect(decryptJSON({ hello: 'world' })).rejects.toThrow(
      'sync: non-envelope payload rejected'
    );
    await expect(decryptJSON(null)).rejects.toThrow(
      'sync: non-envelope payload rejected'
    );
    await expect(decryptJSON(42)).rejects.toThrow(
      'sync: non-envelope payload rejected'
    );
  });
});
