import { describe, test, expect, vi, beforeEach } from 'vitest';
import { createMlKem768 } from 'mlkem';

// Real ML-KEM + a round-trippable session-AEK stand-in, so both recovery paths
// are exercised end to end rather than mocked away. The AEK mock mirrors the
// { update: bytes } shape decodeJSON/encodeJSON produce in production.
vi.mock('@/utils/sync/crypto', () => ({
  encryptJSON: vi.fn(async (obj) =>
    JSON.stringify({ ...obj, update: btoa(String.fromCharCode(...obj.update)) })),

  decryptJSON: async (env) => {
    const parsed = JSON.parse(env);
    parsed.update = Uint8Array.from(atob(parsed.update), (c) => c.charCodeAt(0));
    return parsed;
  },
}));

const clientMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock('../client', () => ({
  getApiClient: () => clientMock,
  ApiError: class ApiError extends Error {},
}));

vi.mock('@/store/account', () => ({
  useAccountStore: () => ({ profile: { id: 'user-1' }, serverUrl: 'https://api.test' }),
}));
vi.mock('@/utils/crypto/identity', () => ({
  loadOrCreateIdentity: async () => ({ privateKeyHex: 'sk-hex', publicKeyHex: 'pk-hex' }),
}));
vi.mock('@/utils/crypto/comment-crypto', () => ({
  encryptName: async () => 'enc-name',
  decryptName: async () => 'name',
}));

const {
  recoverWorkspaceKeyFromRecord,
  recoverWorkspaceKeyHex,
  getCachedWorkspaceKey,
  getWorkspaceKey,
  getWorkspaces,
  buildVaultWrappedKeys,
} = await import('../workspaces.js');

async function hex(buf) {
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}
async function makeKeypair() {
  const k = await createMlKem768();
  const [pk, sk] = k.generateKeyPair();
  return { pkHex: await hex(pk), skHex: await hex(sk) };
}
async function deviceEnvelope(recipientPkHex, keyHex) {
  const { wrapNoteKeyForRecipient } = await import('@/utils/crypto/note-key');
  return wrapNoteKeyForRecipient(recipientPkHex, keyHex);
}

const KEY = 'ab'.repeat(32);

describe('workspace key recovery without any password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('a member recovers the workspace key from their device envelope', async () => {
    const device = await makeKeypair();
    const ws = {
      id: 'ws-device-1',
      wrappedKeys: [{ deviceId: 'dev-a', wrappedKey: await deviceEnvelope(device.pkHex, KEY) }],
    };

    const recovered = await recoverWorkspaceKeyFromRecord(ws, { privateKeyHex: device.skHex });

    expect(recovered).toBe(KEY);
    expect(getCachedWorkspaceKey('ws-device-1')).toBe(KEY);
  });

  test('a second device of an existing member recovers its own envelope', async () => {
    const first = await makeKeypair();
    const second = await makeKeypair();
    const stranger = await makeKeypair();
    const ws = {
      id: 'ws-device-2',
      wrappedKeys: [
        { deviceId: 'dev-a', wrappedKey: await deviceEnvelope(first.pkHex, KEY) },
        { deviceId: null, wrappedKey: await deviceEnvelope(stranger.pkHex, KEY) },
        { deviceId: 'dev-b', wrappedKey: await deviceEnvelope(second.pkHex, KEY) },
      ],
    };

    const recovered = await recoverWorkspaceKeyFromRecord(ws, { privateKeyHex: second.skHex });

    expect(recovered).toBe(KEY);
  });

  test('falls back to the legacy items-key envelope when no device envelope unwraps', async () => {
    const device = await makeKeypair();
    const stranger = await makeKeypair();
    const ws = {
      id: 'ws-legacy-1',
      wrappedKeys: [{ deviceId: 'dev-a', wrappedKey: await deviceEnvelope(stranger.pkHex, KEY) }],
      // Sealed under the session items key: only a device holding that key reads it.
      vaultWrappedKeys: await buildVaultWrappedKeys(KEY),
    };

    const recovered = await recoverWorkspaceKeyFromRecord(ws, { privateKeyHex: device.skHex });

    expect(recovered).toBe(KEY);
    expect(getCachedWorkspaceKey('ws-legacy-1')).toBe(KEY);
  });

  test('prefers the device envelope over the legacy items-key envelope', async () => {
    const device = await makeKeypair();
    const deviceKey = '11'.repeat(32);
    const legacyKey = '22'.repeat(32);
    const ws = {
      id: 'ws-prefer-1',
      wrappedKeys: [{ deviceId: 'dev-a', wrappedKey: await deviceEnvelope(device.pkHex, deviceKey) }],
      vaultWrappedKeys: await buildVaultWrappedKeys(legacyKey),
    };

    const recovered = await recoverWorkspaceKeyFromRecord(ws, { privateKeyHex: device.skHex });

    expect(recovered).toBe(deviceKey);
  });

  test('two workspaces with different keys stay readable without re-encryption', async () => {
    const device = await makeKeypair();
    const keyA = '11'.repeat(32);
    const keyB = '22'.repeat(32);
    const wsA = {
      id: 'ws-ring-a',
      wrappedKeys: [{ deviceId: 'dev-a', wrappedKey: await deviceEnvelope(device.pkHex, keyA) }],
    };
    const wsB = {
      id: 'ws-ring-b',
      wrappedKeys: [{ deviceId: 'dev-a', wrappedKey: await deviceEnvelope(device.pkHex, keyB) }],
    };

    const { encryptJSON } = await import('@/utils/sync/crypto');
    encryptJSON.mockClear();

    const recoveredA = await recoverWorkspaceKeyFromRecord(wsA, { privateKeyHex: device.skHex });
    const recoveredB = await recoverWorkspaceKeyFromRecord(wsB, { privateKeyHex: device.skHex });

    // Both keys are kept, one per workspace: adopting an account vault key must
    // not swap or lose either workspace's already-sealed data.
    expect(recoveredA).toBe(keyA);
    expect(recoveredB).toBe(keyB);
    expect(getCachedWorkspaceKey('ws-ring-a')).toBe(keyA);
    expect(getCachedWorkspaceKey('ws-ring-b')).toBe(keyB);
    // Recovery is read-only: nothing was re-sealed.
    expect(encryptJSON).not.toHaveBeenCalled();
  });

  test('returns null and caches nothing when neither envelope unwraps', async () => {
    const device = await makeKeypair();
    const stranger = await makeKeypair();
    const ws = {
      id: 'ws-none-1',
      wrappedKeys: [{ deviceId: 'dev-x', wrappedKey: await deviceEnvelope(stranger.pkHex, KEY) }],
    };

    const recovered = await recoverWorkspaceKeyFromRecord(ws, { privateKeyHex: device.skHex });

    expect(recovered).toBeNull();
    expect(getCachedWorkspaceKey('ws-none-1')).toBeNull();
  });

  test('recoverWorkspaceKeyHex fetches the record and recovers without a password', async () => {
    const device = await makeKeypair();
    clientMock.get.mockResolvedValue({
      workspaces: [
        {
          id: 'ws-fetch-1',
          wrappedKeys: [{ deviceId: 'dev-a', wrappedKey: await deviceEnvelope(device.pkHex, KEY) }],
        },
      ],
    });

    const recovered = await recoverWorkspaceKeyHex('ws-fetch-1', { privateKeyHex: device.skHex });

    expect(recovered).toBe(KEY);
    expect(clientMock.get).toHaveBeenCalledWith('/workspaces', { signal: undefined });
  });

  test('getWorkspaceKey still returns the caller\'s envelopes only', async () => {
    const device = await makeKeypair();
    const env = await deviceEnvelope(device.pkHex, KEY);
    clientMock.get.mockResolvedValue({
      workspaces: [{ id: 'ws-env-1', wrappedKeys: [{ deviceId: 'dev-a', wrappedKey: env }] }],
    });

    const envelopes = await getWorkspaceKey('ws-env-1');

    expect(envelopes).toEqual([{ deviceId: 'dev-a', wrappedKey: env }]);
  });

  test('getWorkspaces decrypts a legacy-only workspace name via the items-key fallback', async () => {
    clientMock.get.mockResolvedValue({
      workspaces: [
        {
          id: 'ws-name-legacy',
          nameEncrypted: 'enc-name',
          vaultWrappedKeys: await buildVaultWrappedKeys(KEY),
        },
      ],
    });

    const list = await getWorkspaces();

    expect(list[0].name).toBe('name');
  });
});
