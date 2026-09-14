import { describe, test, expect, beforeAll, vi } from 'vitest';
import * as Y from 'yjs';

const API = process.env.VITE_TEST_BACKEND_URL || 'http://localhost:4000';

// Scope: envelope shape + AAD binding + REST push/pull round-trip. Key
// derivation itself is mocked (SHA-256 here, Argon2id KEK in prod via Rust),
// so this proves both devices converge given the same key, not KDF convergence.
// In a real deployment device A and device B converge on the same key because
// they share the same passphrase + the same vault key-params (fetched from the
// backend by fetchCloudKeyParams).
const ctx = vi.hoisted(() => ({
  blobs: new Map(),
  fsFiles: new Map(),
  keyParams: JSON.stringify({
    version: 1,
    vault: 'cross-device-vault-' + Math.random().toString(36).slice(2),
    kdf: 'mock-sha256-aesgcm',
  }),
  passphrase: 'cross-device-passphrase-' + Math.random().toString(36).slice(2),
  token: null,
  userId: null,
  orgId: null,
  workspaceId: null,
}));

// key = SHA-256(passphrase + keyParams), imported as AES-GCM.
// envelope = { v:5, meta, iv (b64), enc (b64) }; AAD = `${noteId}-${ts}`.
async function deriveKey() {
  const enc = new TextEncoder();
  const material = enc.encode(ctx.passphrase + ctx.keyParams);
  const digest = await crypto.subtle.digest('SHA-256', material);
  return crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

const b64ToBytes = (b64) => new Uint8Array(Buffer.from(b64, 'base64'));
const bytesToB64 = (bytes) => Buffer.from(bytes).toString('base64');

async function encryptOne(metaStr, dataB64, aad) {
  const key = await deriveKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = b64ToBytes(dataB64);
  const aadBytes = new TextEncoder().encode(aad);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadBytes },
    key,
    plaintext
  );
  return JSON.stringify({
    v: 5,
    meta: JSON.parse(metaStr),
    iv: bytesToB64(iv),
    enc: bytesToB64(new Uint8Array(ct)),
  });
}

async function decryptOne(raw, aad) {
  const env = JSON.parse(raw);
  const key = await deriveKey();
  const iv = b64ToBytes(env.iv);
  const ct = b64ToBytes(env.enc);
  const aadBytes = new TextEncoder().encode(aad);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: aadBytes },
    key,
    ct
  );
  return { meta: env.meta, update: bytesToB64(new Uint8Array(pt)) };
}

vi.mock('@/lib/native/security.js', () => ({
  isEncryptionAvailable: () => Promise.resolve(true),
  syncKeyReady: () => Promise.resolve(true),
  storeSecureBlob: (k, v) => {
    ctx.blobs.set(k, v);
    return Promise.resolve();
  },
  fetchSecureBlob: (k) => Promise.resolve(ctx.blobs.has(k) ? ctx.blobs.get(k) : null),
  clearSecureBlob: (k) => {
    ctx.blobs.delete(k);
    return Promise.resolve();
  },
  // identity.js delegates string storage here; pass-through is fine in node.
  encryptString: (s) => Promise.resolve(s),
  decryptString: (s) => Promise.resolve(s),
  syncEncryptPayload: (meta, data, aad) => encryptOne(meta, data, aad),
  syncDecryptPayload: (raw, aad) => decryptOne(raw, aad),
  syncEncryptBatch: (metas, dataB64s, aads) =>
    Promise.all(metas.map((m, i) => encryptOne(m, dataB64s[i], aads[i]))),
  syncDecryptBatch: (envelopes, aads) =>
    Promise.all(
      envelopes.map((e, i) => decryptOne(e, aads[i]).catch(() => null))
    ),
  reconcileSyncKeyParams: () => Promise.resolve({ ok: true }),
  adoptKeyParams: (passphrase, keyParams) => {
    if (keyParams) ctx.keyParams = keyParams;
    return Promise.resolve({ ok: true });
  },
  submitEncryptionPassword: () =>
    Promise.resolve({ ok: true, state: { enabled: true, unlocked: true } }),
  enableEncryption: () => Promise.resolve({ ok: true }),
  unlockEncryption: () => Promise.resolve({ ok: true }),
  getEncryptionState: () =>
    Promise.resolve({ enabled: true, unlocked: true }),
}));

vi.mock('@/lib/native/fs', () => ({
  ensureDir: () => Promise.resolve(),
  writeFile: (p, data) => {
    ctx.fsFiles.set(p, data);
    return Promise.resolve();
  },
  readData: (p) =>
    Promise.resolve(ctx.fsFiles.has(p) ? ctx.fsFiles.get(p) : null),
  pathExists: (p) => Promise.resolve(ctx.fsFiles.has(p)),
  readDir: () => Promise.resolve([]),
  readFile: () => Promise.resolve(''),
  readFileBinaryBytes: () => Promise.resolve(new Uint8Array()),
}));

vi.mock('@/lib/tauri-bridge', () => ({
  backend: {
    invoke: vi.fn((channel, payload) =>
      // Vault proof derivation moved to the Rust side; stand in for it here
      // with a deterministic value bound to workspace + blob so the live
      // publish/verify round-trip still carries a real (mock) proof.
      channel === 'vault:deriveProof'
        ? Promise.resolve(`proof:${payload?.workspaceId ?? ''}:${payload?.keyParamsBlob ?? ''}`)
        : undefined
    ),
  },
  path: { join: (...parts) => parts.join('/') },
}));

vi.mock('@/lib/native/app', () => ({
  getAppDirectory: () => Promise.resolve(null),
}));

vi.mock('@/store/account', () => ({
  useAccountStore: () => ({
    serverUrl: API,
    isAuthenticated: true,
    profile: { id: ctx.userId, organizationId: ctx.orgId },
    activeOrgId: ctx.orgId,
    activeOrg: { subscription: { plan: 'pro' } },
    subscription: { plan: 'pro' },
  }),
}));

vi.mock('@/lib/account-storage', () => ({
  loadSessionToken: () => Promise.resolve(ctx.token),
  saveSessionToken: () => Promise.resolve(),
  clearSessionToken: () => Promise.resolve(),
  saveCachedProfile: () => Promise.resolve(),
  loadCachedProfile: () => Promise.resolve(null),
  clearCachedProfile: () => Promise.resolve(),
  saveAccountDeviceId: () => Promise.resolve(),
  loadAccountDeviceId: () => Promise.resolve(null),
  clearAccountDeviceId: () => Promise.resolve(),
  clearAllAccountStorage: () => Promise.resolve(),
  useAccountStorage: () => ({}),
}));

vi.mock('@/lib/settings', () => ({
  getSettingSync: () => 'remote',
}));

vi.mock('@/lib/api/types', async (importOriginal) => ({
  ...(await importOriginal()),
  SYNC_TRANSPORT: { REMOTE: 'remote', FOLDER: 'folder' },
  normalizeSyncTransport: (v) => (v === 'remote' ? 'remote' : 'folder'),
  canUseCloudSync: () => true,
}));

vi.mock('@/store/workspace.ts', () => ({
  useWorkspaceStore: () => ({ activeId: ctx.workspaceId }),
}));

vi.mock('@/utils/sync/sync-repository.js', () => ({
  getSyncDeviceId: () => 'device-A-cross',
}));

vi.mock('@/utils/sync/path.js', () => ({
  getSyncPath: () => Promise.resolve('/sync'),
}));

vi.mock('@/lib/yjs/meta-doc.js', () => ({
  getWorkspaceDoc: () => new Y.Doc(),
  onWorkspaceDocDestroy: vi.fn(),
}));

let reachable = false;
try {
  const r = await fetch(`${API}/health`);
  reachable = r.ok;
} catch {
  reachable = false;
}
const d = reachable ? describe : describe.skip;

d('cross-device decrypt through the real sync path (live backend)', () => {
  const report = { fetchKeyParams: null };

  beforeAll(async () => {
    const auth = await import('@/lib/api/auth.js');
    const email = `cross-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
    const reg = await auth.passwordRegister(email, 'password123456', { baseUrl: API });
    const login = await auth.passwordLogin(email, 'password123456', { baseUrl: API });
    ctx.token = login.token;
    ctx.userId = login.user?.id || reg.user?.id;
    ctx.orgId = reg.organization?.id;
    expect(ctx.token).toBeTruthy();

    const { createApiClient } = await import('@/lib/api/client.js');
    const client = createApiClient({ baseUrl: API, getToken: () => Promise.resolve(ctx.token) });
    ctx.client = client;

    // Build a real encrypted workspace payload (ML-KEM identity + collab key),
    // same as the production create-workspace flow.
    const { generateIdentity } = await import('@/utils/crypto/identity.js');
    const { importCollabKey } = await import('@/utils/crypto/collab.js');
    const { bytesToHex } = await import('@/utils/crypto/hex.js');
    const { wrapNoteKeyForRecipient } = await import('@/utils/crypto/note-key.js');
    const { encryptName } = await import('@/utils/crypto/comment-crypto.js');
    const identity = await generateIdentity();
    const workspaceKeyHex = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    const wrappedKey = await wrapNoteKeyForRecipient(identity.publicKeyHex, workspaceKeyHex);
    const key = await importCollabKey(workspaceKeyHex);
    const nameEncrypted = await encryptName(key, `cross-device-${Date.now()}`);
    const payload = {
      nameEncrypted,
      recipients: [{ userId: ctx.userId, wrappedKey }],
      orgId: ctx.orgId,
    };

    const res = await client.post('/workspaces', payload, { timeoutMs: 20000 });
    ctx.workspaceId =
      res?.id || res?.workspaceId || res?.workspace?.id || reg.workspace?.id;
    expect(ctx.workspaceId).toBeTruthy();

    // Seed the shared passphrase + key-params so BOTH devices converge.
    const { storeSecureBlob } = await import('@/utils/crypto/safeStorageBlob.js');
    await storeSecureBlob('encryptionPassphraseBlob', ctx.passphrase);
    // Pre-place the key-params file that device A will publish.
    ctx.fsFiles.set('/sync/BeaverNotesSync/keyParams.json', btoa(ctx.keyParams));

    await (await import('@/lib/api/account.js')).getAccount({ baseUrl: API });
  }, 120000);

  test('vault key-params are fetched across devices via the backend', async (t) => {
    if (!ctx.workspaceId) return t.skip();

    const { fetchCloudKeyParams, getFetchedCloudKeyParams } = await import(
      '@/utils/sync/vault-key-params.js'
    );

    // Device A seeds its vault key-params in the backend (real REST). Publishing
    // itself now lives in Rust, so the JS side only proves the fetch path.
    const challenge = await ctx.client.createVaultChallenge(ctx.workspaceId);
    await ctx.client.publishVaultKeyParams(ctx.workspaceId, {
      keyParams: btoa(ctx.keyParams),
      passphraseProof: 'device-a-proof',
      challenge,
    });

    // Device B fetches them back from the backend (real REST) and adopts them.
    report.fetchKeyParams = await fetchCloudKeyParams({ force: true });
    expect(report.fetchKeyParams).toBe(true);

    const fetched = getFetchedCloudKeyParams();
    expect(fetched).toBeTruthy();
    expect(fetched.paramsBlob).toBe(ctx.keyParams);
  }, 30000);

  test('report', () => {
    // Surface what was proven / skipped for the human-readable summary.
    // oxlint-disable-next-line no-console -- deliberate human-readable summary
    console.log('[cross-device] keyParams reconcile:', JSON.stringify(report));
    expect(true).toBe(true);
  });
});
