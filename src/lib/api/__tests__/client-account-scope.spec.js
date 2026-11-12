import { describe, it, expect, beforeEach, vi } from 'vitest';

// Stateful secure-blob mock: the credential round-trip has to actually persist
// or a scoping bug would be invisible.
const { blobs } = vi.hoisted(() => ({ blobs: new Map() }));

vi.mock('@/lib/native/security', () => ({
  isEncryptionAvailable: vi.fn(async () => true),
  encryptString: vi.fn(async (s) => `cipher:${s}`),
  decryptString: vi.fn(async (s) => s.replace(/^cipher:/, '')),
  storeSecureBlob: vi.fn(async (key, value) => {
    blobs.set(key, value);
  }),
  fetchSecureBlob: vi.fn(async (key) => blobs.get(key) ?? null),
  clearSecureBlob: vi.fn(async (key) => {
    blobs.delete(key);
  }),
}));

const storeState = vi.hoisted(() => ({ setToken: null, setStatus: null }));

vi.mock('@/store/account', () => ({
  useAccountStore: () => ({
    setToken: storeState.setToken,
    setStatus: storeState.setStatus,
  }),
}));

vi.mock('@/utils/sync/rust-shim', () => ({
  isRustSyncActive: () => false,
  startRustSync: vi.fn(async () => {}),
}));

const { createApiClient } = await import('@/lib/api/client');
const { saveIndex, setActiveAccountId, clearIndex } = await import(
  '@/lib/accounts-index'
);
const {
  saveSessionToken,
  loadSessionToken,
  saveRefreshToken,
  loadRefreshToken,
} = await import('@/lib/account-storage');

function response(body, status = 200) {
  return {
    ok: status < 400,
    status,
    text: async () => (body == null ? '' : JSON.stringify(body)),
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

describe('api client credential scope', () => {
  beforeEach(async () => {
    localStorage.clear();
    blobs.clear();
    vi.clearAllMocks();
    storeState.setToken = vi.fn();
    storeState.setStatus = vi.fn();
    await clearIndex();
  });

  it('rotates the credentials of the account the request was made for', async () => {
    await saveSessionToken('session-a1', 'a1');
    await saveRefreshToken('refresh-a1', 'a1');
    await saveSessionToken('session-a2', 'a2');
    await saveRefreshToken('refresh-a2', 'a2');
    await saveIndex({
      accounts: [{ id: 'a1' }, { id: 'a2' }],
      activeAccountId: 'a2',
    });

    let switched = false;
    const fetchImpl = vi.fn(async (url, init) => {
      if (url.endsWith('/auth/refresh')) {
        expect(JSON.parse(init.body)).toEqual({ refreshToken: 'refresh-a2' });
        return response({
          token: 'session-a2-new',
          refreshToken: 'refresh-a2-new',
        });
      }
      if (!switched) {
        switched = true;
        // The user switched accounts while this request was in flight: the
        // 401 belongs to a2, so a2's refresh token must be the one rotated.
        setActiveAccountId('a1');
        return response({ error: 'session_expired', message: 'expired' }, 401);
      }
      return response({ workspaces: [] });
    });

    const client = createApiClient({
      baseUrl: 'http://localhost:4000',
      fetchImpl,
    });
    await client.get('/workspaces');

    expect(await loadSessionToken('a2')).toBe('session-a2-new');
    expect(await loadRefreshToken('a2')).toBe('refresh-a2-new');
    // The account the app moved to is untouched — no rotation, no clearing.
    expect(await loadSessionToken('a1')).toBe('session-a1');
    expect(await loadRefreshToken('a1')).toBe('refresh-a1');
  });

  it('a dead refresh token signs out its own account only', async () => {
    await saveSessionToken('session-a1', 'a1');
    await saveRefreshToken('refresh-a1', 'a1');
    await saveSessionToken('session-a2', 'a2');
    await saveRefreshToken('dead-a2', 'a2');
    await saveIndex({
      accounts: [{ id: 'a1' }, { id: 'a2' }],
      activeAccountId: 'a2',
    });

    let switched = false;
    const fetchImpl = vi.fn(async () => {
      if (!switched) {
        switched = true;
        setActiveAccountId('a1');
      }
      return response({ error: 'invalid_refresh_token', message: 'dead' }, 401);
    });

    const client = createApiClient({
      baseUrl: 'http://localhost:4000',
      fetchImpl,
    });
    await expect(client.get('/workspaces')).rejects.toMatchObject({ status: 401 });

    expect(await loadRefreshToken('a2')).toBeNull();
    expect(await loadSessionToken('a2')).toBeNull();
    expect(await loadSessionToken('a1')).toBe('session-a1');
    expect(await loadRefreshToken('a1')).toBe('refresh-a1');
    // a2 is no longer the active account, so the store (which now holds a1)
    // must not be signed out.
    expect(storeState.setStatus).not.toHaveBeenCalledWith('anonymous');
  });

  it('falls back to the legacy slot when no account is active', async () => {
    // An install that has not run the account migration yet: no index, so the
    // client must use the unsuffixed blobs instead of throwing.
    await saveSessionToken('legacy-session');
    await saveRefreshToken('legacy-refresh');

    const fetchImpl = vi.fn(async (url, init) => {
      if (url.endsWith('/auth/refresh')) {
        expect(JSON.parse(init.body)).toEqual({ refreshToken: 'legacy-refresh' });
        return response({
          token: 'legacy-new',
          refreshToken: 'legacy-new-refresh',
        });
      }
      if (init?.headers?.Authorization === 'Bearer legacy-session') {
        return response({ error: 'session_expired', message: 'expired' }, 401);
      }
      return response({ workspaces: [] });
    });

    const client = createApiClient({
      baseUrl: 'http://localhost:4000',
      fetchImpl,
    });
    await client.get('/workspaces');

    expect(await loadSessionToken()).toBe('legacy-new');
    expect(await loadRefreshToken()).toBe('legacy-new-refresh');
  });
});
