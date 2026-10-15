import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const { blobs, teardownSpy, switchSpy, runInitSpy } = vi.hoisted(() => ({
  blobs: new Map(),
  teardownSpy: vi.fn(async () => {}),
  switchSpy: vi.fn(async () => {}),
  runInitSpy: vi.fn(async () => {}),
}));

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

// Signing out of one account runs the same heavy teardown as a full sign-out.
vi.mock('@/lib/api/auth', () => ({
  logout: vi.fn(async () => ({})),
  passwordLogin: vi.fn(async () => ({
    token: 'tok',
    refreshToken: 'refresh-tok',
    user: { id: 'n1', email: 'new@test.test' },
    subscription: { plan: 'pro' },
  })),
}));
vi.mock('@/lib/api/account', () => ({
  getAccount: vi.fn(async () => ({
    profile: { id: 'n1', email: 'new@test.test', kemPublicKey: 'pk' },
    subscription: { plan: 'pro' },
    organizations: [{ id: 'o1', workspaces: [{ id: 'w-new', name: 'New Team' }] }],
    devices: [],
  })),
}));
vi.mock('@/utils/sync/sync-repository.js', () => ({ getSyncDeviceId: vi.fn(async () => 'dev-1') }));
vi.mock('@/composable/useNoteYjs.js', () => ({ flushAllNoteYjsPending: vi.fn(async () => {}) }));
vi.mock('@/lib/sync/ws-sync.js', () => ({ getWsSync: () => ({ stop: vi.fn() }) }));
vi.mock('@/lib/yjs/workspace-doc.js', () => ({ flushPendingMetaUpdates: vi.fn(async () => {}) }));
vi.mock('@/lib/yjs/meta-doc.js', () => ({ destroyWorkspaceDoc: vi.fn() }));
vi.mock('@/store/note', () => ({
  useNoteStore: () => ({ data: {}, syncInProgress: false }),
  clearNoteContentSignatures: vi.fn(),
}));
vi.mock('@/store/comment', () => ({ useCommentStore: () => ({ reset: vi.fn() }) }));
vi.mock('@/store/collaborator', () => ({ useCollaboratorStore: () => ({ reset: vi.fn() }) }));
vi.mock('@/store/workspace', () => ({
  useWorkspaceStore: () => ({ activeId: null, reset: vi.fn() }),
}));
vi.mock('@/utils/note/search.js', () => ({ clearSearchIndex: vi.fn() }));
vi.mock('@/utils/sync/rust-shim.js', () => ({
  stopRustSync: vi.fn(async () => {}),
  startRustSync: vi.fn(async () => {}),
  isRustSyncActive: () => false,
}));

vi.mock('@/composable/useCloudWorkspaces', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useCloudWorkspaces: () => ({
      ...actual.useCloudWorkspaces(),
      teardownLiveWorkspaceState: teardownSpy,
    }),
  };
});
vi.mock('@/lib/native/workspaces', () => ({
  switchLocalWorkspace: switchSpy,
  listLocalWorkspaces: vi.fn(async () => []),
  getActiveLocalWorkspace: vi.fn(async () => null),
}));
vi.mock('@/composable/useAppShell', () => ({ runWorkspaceInit: runInitSpy }));
vi.mock('@/utils/crypto/identity', () => ({
  loadOrCreateIdentity: vi.fn(async () => ({ publicKeyHex: 'pk', privateKeyHex: 'sk' })),
  publishIdentity: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/utils/sync/shared-keys', () => ({ clearSharedSyncKeys: vi.fn(async () => {}) }));

import { useAccountAuth } from '@/composable/useAccountAuth';
import { useCloudWorkspaces } from '@/composable/useCloudWorkspaces';
import { useAccountStore } from '@/store/account';
import { clearIndex, getActiveAccountId, listAccounts, saveIndex } from '@/lib/accounts-index';
import { loadRefreshToken, loadSessionToken, saveRefreshToken, saveSessionToken } from '@/lib/account-storage';

const PERSONAL = {
  id: 'p1',
  email: 'me@test.test',
  workspaces: [{ id: 'w-personal', name: 'Personal' }],
  activeWorkspaceId: 'w-personal',
};
const TEAM = {
  id: 't1',
  email: 'team@test.test',
  workspaces: [{ id: 'w-team', name: 'Acme Team' }],
  activeWorkspaceId: 'w-team',
};

describe('signInWithPassword', () => {
  let signIn = null;

  beforeEach(async () => {
    setActivePinia(createPinia());
    localStorage.clear();
    blobs.clear();
    vi.clearAllMocks();
    await clearIndex();
    signIn = useAccountAuth().signInWithPassword;
  });

  it('records the account so the switcher can show it, and makes it active', async () => {
    const result = await signIn('new@test.test', 'password');

    expect(result.token).toBe('tok');
    // The session must land in the account's own slot: the record is what the
    // switcher renders and what a later switch reads the token back from.
    expect(await loadSessionToken('n1')).toBe('tok');
    expect(getActiveAccountId()).toBe('n1');
    expect(listAccounts()).toHaveLength(1);
    expect(listAccounts()[0]).toMatchObject({
      id: 'n1',
      email: 'new@test.test',
      activeWorkspaceId: 'w-new',
      workspaces: [{ id: 'w-new', name: 'New Team' }],
    });
    const store = useAccountStore();
    expect(store.token).toBe('tok');
    expect(store.status).toBe('authenticated');
  });
});

describe('signOutAccount', () => {
  let signOutAccount = null;

  beforeEach(async () => {
    setActivePinia(createPinia());
    localStorage.clear();
    blobs.clear();
    vi.clearAllMocks();
    teardownSpy.mockImplementation(async () => {});
    switchSpy.mockImplementation(async () => {});
    runInitSpy.mockImplementation(async () => {});
    await clearIndex();
    useCloudWorkspaces().activeId.value = null;
    signOutAccount = useAccountAuth().signOutAccount;
  });

  it('leaves no readable credential behind and moves to the remaining account', async () => {
    await saveIndex({ accounts: [PERSONAL, TEAM], activeAccountId: 't1' });
    await saveSessionToken('session-t1', 't1');
    await saveRefreshToken('refresh-t1', 't1');
    await saveSessionToken('session-p1', 'p1');

    const result = await signOutAccount('t1');

    expect(await loadSessionToken('t1')).toBeNull();
    expect(await loadRefreshToken('t1')).toBeNull();
    expect(listAccounts().map((a) => a.id)).not.toContain('t1');
    expect(getActiveAccountId()).toBe('p1');
    // The remaining account is re-initialised in place, on its own workspace.
    expect(result.switched).toBe(true);
    expect(switchSpy).toHaveBeenCalledWith('w-personal');
  });

  it('leaves the active account alone when an inactive one signs out', async () => {
    await saveIndex({ accounts: [PERSONAL, TEAM], activeAccountId: 'p1' });
    await saveSessionToken('session-t1', 't1');
    await saveSessionToken('session-p1', 'p1');

    const result = await signOutAccount('t1');

    expect(result.switched).toBe(false);
    expect(getActiveAccountId()).toBe('p1');
    expect(await loadSessionToken('p1')).toBe('session-p1');
    expect(await loadSessionToken('t1')).toBeNull();
    expect(switchSpy).not.toHaveBeenCalled();
  });
});
