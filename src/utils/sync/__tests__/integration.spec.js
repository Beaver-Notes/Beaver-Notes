import { describe, test, expect, beforeAll, vi } from 'vitest';
import { createApiClient } from '@/lib/api/client.js';
const WSImpl = (await import('ws').catch(() => null))?.WebSocket ?? globalThis.WebSocket;

const API = process.env.VITE_TEST_BACKEND_URL || 'http://localhost:3000';
const WS = process.env.VITE_TEST_WS_URL || 'ws://localhost:8080';

// Shared, mutable session state used by the mocked account-store / token loader.
const state = vi.hoisted(() => ({
  serverUrl: null,
  token: null,
  userId: null,
  orgId: null,
}));

// The sync transport reads the server URL from the account store and the auth
// token from account-storage. In a node/vitest process neither the Tauri
// secure-storage nor the real store exist, so we stub them with the live
// session we obtain below. Every HTTP request still goes to the real backend.
vi.mock('@/store/account', () => ({
  useAccountStore: () => ({
    serverUrl: state.serverUrl,
    profile: { id: state.userId, organizationId: state.orgId },
    activeOrgId: state.orgId,
  }),
}));

vi.mock('@/lib/account-storage', () => ({
  loadSessionToken: () => Promise.resolve(state.token),
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

// ----- probe backend reachability (top-level, before importing heavy modules) -----
let reachable = false;
try {
  const r = await fetch(`${API}/health`);
  reachable = r.ok;
} catch {
  reachable = false;
}
const d = reachable ? describe : describe.skip;

// Register + login a brand new account. LEGACY_AUTH_ENABLED so password auth
// works. Returns the live token + ids confirmed from the actual responses.
async function newAccount(prefix) {
  const auth = await import('@/lib/api/auth.js');
  const email = `${prefix}${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
  const reg = await auth.passwordRegister(email, 'password123456', { baseUrl: API });
  const login = await auth.passwordLogin(email, 'password123456', { baseUrl: API });
  return {
    email,
    token: login.token,
    userId: login.user?.id || reg.user?.id,
    orgId: reg.organization?.id,
    defaultWorkspaceId: reg.workspace?.id,
  };
}

// Replicates provisionWorkspacePayload using the EXACT same crypto helpers, but
// without relying on the Tauri secure-storage identity (which is unavailable in
// node). generateIdentity() is the real ML-KEM keygen used in production.
async function buildWorkspacePayload(name) {
  const { generateIdentity } = await import('@/utils/crypto/identity.js');
  const { importCollabKey } = await import('@/utils/crypto/collab.js');
  const { bytesToHex } = await import('@/utils/crypto/hex.js');
  const { wrapNoteKeyForRecipient } = await import('@/utils/crypto/note-key.js');
  const { encryptName } = await import('@/utils/crypto/comment-crypto.js');
  const identity = await generateIdentity();
  const workspaceKeyHex = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const wrappedKey = await wrapNoteKeyForRecipient(
    identity.publicKeyHex,
    workspaceKeyHex
  );
  const key = await importCollabKey(workspaceKeyHex);
  const nameEncrypted = await encryptName(key, name);
  return {
    nameEncrypted,
    recipients: [{ userId: state.userId, wrappedKey }],
    orgId: state.orgId,
  };
}

function base64(bytes) {
  if (typeof btoa === 'function') {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  }
  return Buffer.from(bytes).toString('base64');
}

d('sync + collab integration (two sessions, one process, live backend)', () => {
  let userA, userB, workspaceId, account;

  beforeAll(async () => {
    userA = await newAccount('a');
    userB = await newAccount('b');
    expect(userA.token).toBeTruthy();
    expect(userB.token).toBeTruthy();
    expect(userA.userId).not.toEqual(userB.userId);

    // Wire the mocked store/token so the real sync transport uses user A's session.
    state.serverUrl = API;
    state.token = userA.token;
    state.userId = userA.userId;
    state.orgId = userA.orgId;

    const payload = await buildWorkspacePayload(`Integration ${Date.now()}`);
    const client = createApiClient({
      baseUrl: API,
      getToken: () => Promise.resolve(userA.token),
    });
    const res = await client.post('/workspaces', payload, { timeoutMs: 20000 });
    workspaceId =
      res?.id || res?.workspaceId || res?.workspace?.id || userA.defaultWorkspaceId;
    expect(workspaceId).toBeTruthy();

    account = await (await import('@/lib/api/account.js')).getAccount({
      baseUrl: API,
    });
  }, 120000);

  test('registers and logs in two independent accounts', () => {
    expect(userA.userId).toBeTruthy();
    expect(userB.userId).toBeTruthy();
    expect(userA.token).not.toEqual(userB.token);
  });

  test('REST push -> pull round-trips an update (Goal 1)', async (ctx) => {
    if (!workspaceId) return ctx.skip();
    const { pushUpdates, pullUpdates } = await import(
      '@/utils/sync/remote-yjs.js'
    );
    const { getSyncDeviceId } = await import('@/utils/sync/sync-repository.js');
    const { YJS_UPDATE_EXT } = await import('@/utils/sync/constants.js');
    const noteId = `note-${Date.now()}`;
    const original = base64(crypto.getRandomValues(new Uint8Array(16)));
    const deviceId = getSyncDeviceId();
    const ts = Date.now();
    const key = `${noteId}~~${deviceId}~~${ts}~~1${YJS_UPDATE_EXT}`;
    const push = await pushUpdates(workspaceId, [
      {
        noteId,
        updates: [{ key, data: original, deviceId, ts, sequence: 1 }],
      },
    ]);
    expect(push.accepted).toBeGreaterThanOrEqual(1);

    const pull = await pullUpdates(workspaceId, [{ noteId }]);
    const updates = pull?.notes?.[noteId]?.updates || [];
    expect(updates.length).toBeGreaterThanOrEqual(1);
    const match = updates.find((u) => u.key === key && u.data === original);
    expect(match).toBeTruthy();
  }, 30000);

  test('workspace bootstrap state + present in owner account (Goal 2)', async (ctx) => {
    if (!workspaceId) return ctx.skip();
    const { getRemoteState } = await import('@/utils/sync/remote-yjs.js');
    const stateInfo = await getRemoteState(workspaceId);
    expect(['empty', 'initializing', 'initialized', 'recovering']).toContain(
      stateInfo.status
    );
    expect(Array.isArray(stateInfo.documents)).toBe(true);

    const inAccount = account?.organizations
      ?.flatMap((o) => o.workspaces || [])
      .some((w) => w.id === workspaceId);
    expect(inAccount).toBe(true);
  }, 30000);

  test('Hocuspocus WS authenticates with token on root path (Goal 3)', async () => {
    const url = `${WS}/?token=${encodeURIComponent(userA.token)}`;
    const sock = new WSImpl(url);
    const authed = await new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), 5000);
      sock.on('open', () => {
        clearTimeout(t);
        resolve(true);
      });
      sock.on('error', (e) => {
        clearTimeout(t);
        console.warn('[ws] error', e?.message);
        resolve(false);
      });
      sock.on('close', () => clearTimeout(t));
    });
    expect(authed).toBe(true);
    sock.close();
  }, 10000);
});
