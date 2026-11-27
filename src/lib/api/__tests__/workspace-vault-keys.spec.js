import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mirror the Rust sync crypto contract with WebCrypto AES-GCM so envelopes are
// genuinely round-tripped (same approach as snapshot-bytetype.spec.js):
// envelope = { v:5, meta, iv (b64), enc (b64) }; update returned as base64.
const KEY = new Uint8Array(32).fill(11);
let cryptoKey;

async function deriveKey() {
  if (!cryptoKey) {
    cryptoKey = await crypto.subtle.importKey(
      'raw', KEY, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
    );
  }
  return cryptoKey;
}
const b64ToBytes = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
const bytesToB64 = (b) => btoa(String.fromCharCode(...b));

const encryptCalls = [];

async function rustEncrypt(meta, dataB64, aad) {
  encryptCalls.push({ meta, dataB64, aad });
  const k = await deriveKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = b64ToBytes(dataB64);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) },
    k, pt
  );
  return JSON.stringify({
    v: 5, meta: JSON.parse(meta),
    iv: bytesToB64(iv), enc: bytesToB64(new Uint8Array(ct)),
  });
}
async function rustDecrypt(env, aad) {
  const e = JSON.parse(env);
  const k = await deriveKey();
  const iv = b64ToBytes(e.iv);
  const ct = b64ToBytes(e.enc);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) },
    k, ct
  );
  return { meta: e.meta, update: bytesToB64(new Uint8Array(pt)) };
}

vi.mock('@/utils/crypto/encryption.js', () => ({ isEncryptionEnabled: () => true }));
// SC-1-02: stateful safeStorage mock so tests can assert which SLOT received
// the workspace-key cipher (same approach as account-storage.spec.js). The
// fns are vi.fn so race tests can block them mid-flight (ISSUE-3).
const { wsBlobs } = vi.hoisted(() => ({ wsBlobs: new Map() }));

vi.mock('@/lib/native/security.js', () => ({
  syncEncryptPayload: (meta, data, aad) => rustEncrypt(meta, data, aad),
  syncDecryptPayload: (enc, aad) => rustDecrypt(enc, aad),
  syncKeyReady: () => Promise.resolve(true),
  isEncryptionAvailable: vi.fn(async () => true),
  encryptString: vi.fn(async (s) => `cipher:${s}`),
  decryptString: vi.fn(async (s) => s.replace(/^cipher:/, '')),
  storeSecureBlob: vi.fn(async (key, blob) => {
    wsBlobs.set(key, blob);
  }),
  fetchSecureBlob: vi.fn(async (key) => wsBlobs.get(key) ?? null),
  clearSecureBlob: vi.fn(async (key) => {
    wsBlobs.delete(key);
  }),
}));

const accountMock = {
  profile: { id: 'user-1', organizationId: null },
  activeOrgId: 'org-1',
};
vi.mock('@/store/account', () => ({
  useAccountStore: () => accountMock,
}));
vi.mock('@/utils/crypto/identity', () => ({
  loadOrCreateIdentity: async () => ({ publicKeyHex: 'pk-hex', privateKeyHex: 'sk-hex' }),
}));
const wrapCalls = [];
vi.mock('@/utils/crypto/note-key', () => ({
  wrapNoteKeyForRecipient: async (_pub, hex) => {
    wrapCalls.push(hex);
    return `wrapped:${hex}`;
  },
  unwrapNoteKey: async () => 'unused',
}));
vi.mock('@/utils/crypto/collab', () => ({
  importCollabKey: async () => ({ alg: 'AES-GCM' }),
}));
vi.mock('@/utils/crypto/comment-crypto', () => ({
  encryptName: async () => 'enc-name',
  decryptName: async () => 'name',
}));

const clientMock = {
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
};
vi.mock('../client', () => ({
  getApiClient: () => clientMock,
  ApiError: class ApiError extends Error {},
}));

const {
  VAULT_WRAPPED_KEYS_AAD,
  buildVaultWrappedKeys,
  unwrapWorkspaceKeysFromVault,
  createWorkspace,
  getCachedWorkspaceKey,
  setCachedWorkspaceKey,
  clearWorkspaceKeyCache,
  hydrateWorkspaceKeys,
} = await import('../workspaces.js');
const { syncEncryptPayload } = await import('@/lib/native/security.js');
const { decryptJSON } = await import('@/utils/sync/crypto.js');
const { adoptWorkspaceKeysFromVault } = await import('@/utils/onboarding/remote-vault-join.js');

const HEX = 'ab'.repeat(32);

describe('vault-wrapped workspace keys', () => {
  beforeEach(() => {
    encryptCalls.length = 0;
    wrapCalls.length = 0;
    vi.clearAllMocks();
  });

  test('buildVaultWrappedKeys seals the key under the session AEK with the vault AAD', async () => {
    const env = await buildVaultWrappedKeys(HEX);

    expect(typeof env).toBe('string');
    expect(JSON.parse(env).v).toBe(5);

    expect(encryptCalls).toHaveLength(1);
    const { meta, dataB64, aad } = encryptCalls[0];
    // The envelope must satisfy the Rust SyncMeta contract.
    const parsedMeta = JSON.parse(meta);
    expect(parsedMeta.device).toBe('beaver-vault');
    expect(parsedMeta.noteId).toBe('workspace-keys');
    expect(typeof parsedMeta.ts).toBe('number');
    // The key material travels inside the encrypted payload...
    expect(JSON.parse(new TextDecoder().decode(b64ToBytes(dataB64)))).toEqual({
      workspaceKey: HEX,
    });
    // ...bound to the vault domain so it cannot be replayed as sync data.
    expect(aad).toBe(VAULT_WRAPPED_KEYS_AAD);
    expect(aad).toBe('beaver-workspace-keys:v1');
  });

  test('envelope round-trips through decryptJSON back to the raw key hex', async () => {
    const env = await buildVaultWrappedKeys(HEX);
    const recovered = await unwrapWorkspaceKeysFromVault(env);
    expect(recovered).toEqual({ workspaceKeyHex: HEX });
  });

  test('unwrap returns null for garbage or tampered envelopes instead of throwing', async () => {
    expect(await unwrapWorkspaceKeysFromVault(null)).toBeNull();
    expect(await unwrapWorkspaceKeysFromVault(undefined)).toBeNull();
    expect(await unwrapWorkspaceKeysFromVault('')).toBeNull();
    expect(await unwrapWorkspaceKeysFromVault('not-an-envelope')).toBeNull();

    // Flip one ciphertext character: authentication must fail -> null.
    const env = await buildVaultWrappedKeys(HEX);
    const parsed = JSON.parse(env);
    parsed.enc = (parsed.enc.startsWith('A') ? 'B' : 'A') + parsed.enc.slice(1);
    expect(await unwrapWorkspaceKeysFromVault(JSON.stringify(parsed))).toBeNull();

    // An envelope sealed under a different AAD (regular sync payload
    // semantics) must not unwrap: AES-GCM authentication fails on the domain
    // mismatch -> null.
    const foreignAad = 'beaver-notes:regular-sync:v1';
    const foreignEnv = await syncEncryptPayload(
      JSON.stringify({ device: 'beaver-vault', ts: Date.now(), noteId: 'workspace-keys' }),
      bytesToB64(new TextEncoder().encode(JSON.stringify({ workspaceKey: HEX }))),
      foreignAad
    );
    // Sanity: the very same envelope decrypts cleanly under its own AAD, so
    // the rejection below can only come from the cross-domain binding.
    const ownDomain = await decryptJSON(foreignEnv, foreignAad);
    expect(ownDomain).toEqual(
      expect.objectContaining({ device: 'beaver-vault', noteId: 'workspace-keys' })
    );
    expect(JSON.parse(new TextDecoder().decode(ownDomain.update))).toEqual({
      workspaceKey: HEX,
    });
    expect(await unwrapWorkspaceKeysFromVault(foreignEnv)).toBeNull();

    expect(await unwrapWorkspaceKeysFromVault('{}')).toBeNull();
  });

  // The vault-wrapped-keys blob is a session-AEK envelope; `decryptJSON` accepts
  // the legacy v4 protocol shape and the v5 raw shape. v6 (shared-note payload)
  // is a different envelope class, decrypted by Rust `syncDecryptPayload` and
  // covered by the Rust suite (cargo test --lib, cloud.rs version tests).
  test('v4/v5 workspace-key envelopes still decrypt (backward compatibility)', async () => {
    const env = await buildVaultWrappedKeys(HEX);
    for (const v of [4, 5]) {
      const parsed = JSON.parse(env);
      parsed.v = v;
      expect(await unwrapWorkspaceKeysFromVault(JSON.stringify(parsed))).toEqual({
        workspaceKeyHex: HEX,
      });
    }
  });

  test('createWorkspace posts vaultWrappedKeys in the create body and seeds the cache', async () => {
    clientMock.post.mockResolvedValue({ id: 'ws-create' });

    await createWorkspace('Design Team');

    expect(clientMock.post).toHaveBeenCalledTimes(1);
    const [path, body] = clientMock.post.mock.calls[0];
    expect(path).toBe('/workspaces');

    expect(body.orgId).toBe('org-1');
    // The workspace key is generated fresh per creation; only its shape is known.
    expect(wrapCalls).toHaveLength(1);
    expect(wrapCalls[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(body.recipients).toEqual([
      { userId: 'user-1', wrappedKey: `wrapped:${wrapCalls[0]}` },
    ]);
    expect(typeof body.vaultWrappedKeys).toBe('string');

    // The posted envelope recovers exactly the key that was ML-KEM-wrapped.
    const recovered = await unwrapWorkspaceKeysFromVault(body.vaultWrappedKeys);
    expect(recovered.workspaceKeyHex).toBe(wrapCalls[0]);

    // The creator knows the raw key up front: seed the local cache immediately.
    expect(getCachedWorkspaceKey('ws-create')).toBe(wrapCalls[0]);
  });

  test('adoptWorkspaceKeysFromVault caches the recovered key with zero network calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const env = await buildVaultWrappedKeys(HEX);

    const ok = await adoptWorkspaceKeysFromVault({
      id: 'ws-join',
      vaultWrappedKeys: env,
    });

    expect(ok).toBe(true);
    expect(getCachedWorkspaceKey('ws-join')).toBe(HEX);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test('adoptWorkspaceKeysFromVault is a no-op without an envelope or on failure', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    expect(await adoptWorkspaceKeysFromVault(undefined)).toBe(false);
    expect(await adoptWorkspaceKeysFromVault({ id: 'ws-none' })).toBe(false);
    expect(
      await adoptWorkspaceKeysFromVault({ id: 'ws-bad', vaultWrappedKeys: 'garbage' })
    ).toBe(false);
    expect(getCachedWorkspaceKey('ws-none')).toBeNull();
    expect(getCachedWorkspaceKey('ws-bad')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

// SC-1-02: the workspace key is the E2E root for every note in the workspace,
// so the mirror must ride safeStorage like every other credential — never
// plaintext localStorage.
describe('SC-1-02: workspace keys persist through safeStorage, not plaintext', () => {
  beforeEach(() => {
    localStorage.clear();
    wsBlobs.clear();
    clearWorkspaceKeyCache();
  });

  test('setCachedWorkspaceKey stores a cipher in the secure blob and the encrypted mirror', async () => {
    setCachedWorkspaceKey('ws-sec', HEX);

    await vi.waitFor(() => {
      expect(wsBlobs.get('workspaceKeysSecure')).toBeTruthy();
    });
    const cipher = wsBlobs.get('workspaceKeysSecure');
    expect(cipher).toMatch(/^cipher:/);
    expect(localStorage.getItem('workspace-keys-v2')).toBe(cipher);
    // No plaintext copy anywhere on disk: the pre-fix mirror key is gone and
    // the v2 mirror holds only the safeStorage cipher.
    expect(localStorage.getItem('workspace-keys')).toBeNull();
    expect(localStorage.getItem('workspace-keys-v2')).not.toContain(HEX);
  });

  test('hydrateWorkspaceKeys re-seeds the cache from the secure blob on cold start', async () => {
    setCachedWorkspaceKey('ws-cold', HEX);
    await vi.waitFor(() => {
      expect(wsBlobs.get('workspaceKeysSecure')).toBeTruthy();
    });
    const cipher = wsBlobs.get('workspaceKeysSecure');

    clearWorkspaceKeyCache();
    expect(getCachedWorkspaceKey('ws-cold')).toBeNull();
    // Let the chained blob wipe land, then re-seed it as a persisted install
    // would have it and hydrate.
    await new Promise((resolve) => setTimeout(resolve, 0));
    wsBlobs.set('workspaceKeysSecure', cipher);
    await hydrateWorkspaceKeys();

    expect(getCachedWorkspaceKey('ws-cold')).toBe(HEX);
  });

  test('the pre-fix plaintext mirror is migrated to safeStorage and deleted', async () => {
    // A pre-fix install left the raw hex JSON in localStorage.
    localStorage.setItem('workspace-keys', JSON.stringify({ 'ws-legacy': HEX }));

    await hydrateWorkspaceKeys();

    expect(getCachedWorkspaceKey('ws-legacy')).toBe(HEX);
    await vi.waitFor(() => {
      expect(wsBlobs.get('workspaceKeysSecure')).toMatch(/^cipher:/);
    });
    expect(localStorage.getItem('workspace-keys')).toBeNull();
    expect(localStorage.getItem('workspace-keys-v2')).toMatch(/^cipher:/);
  });

  test('clearWorkspaceKeyCache wipes the secure blob and both mirrors', async () => {
    setCachedWorkspaceKey('ws-wipe', HEX);
    await vi.waitFor(() => {
      expect(wsBlobs.get('workspaceKeysSecure')).toBeTruthy();
    });

    clearWorkspaceKeyCache();

    expect(getCachedWorkspaceKey('ws-wipe')).toBeNull();
    expect(localStorage.getItem('workspace-keys-v2')).toBeNull();
    expect(localStorage.getItem('workspace-keys')).toBeNull();
    // The blob wipe rides the persist chain (ISSUE-3), so it lands a tick later.
    await vi.waitFor(() => {
      expect(wsBlobs.get('workspaceKeysSecure')).toBeUndefined();
    });
  });

  // ISSUE-3: the cipher is produced asynchronously; a clear (account switch /
  // sign-out) landing while it is in flight must drop the write, or the
  // previous account's keys would be re-persisted after sign-out.
  test('a clear landing mid-persist drops the write (no resurrection)', async () => {
    const security = await import('@/lib/native/security.js');
    let releaseCipher;
    security.encryptString.mockImplementationOnce(
      () => new Promise((resolve) => { releaseCipher = resolve; })
    );

    setCachedWorkspaceKey('ws-race', HEX);
    // The queued persist is now blocked inside encryptString.
    await vi.waitFor(() => expect(releaseCipher).toBeDefined());

    clearWorkspaceKeyCache(); // generation bumps while the cipher is in flight
    releaseCipher(`cipher:${HEX}`); // persist resumes — it must be dropped

    // Let the chain settle: the dropped task, then the chained blob wipe.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(localStorage.getItem('workspace-keys-v2')).toBeNull();
    expect(wsBlobs.get('workspaceKeysSecure')).toBeUndefined();
    expect(getCachedWorkspaceKey('ws-race')).toBeNull();
  });
});
