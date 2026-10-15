import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// Stateful blob mock: identity + credentials only reach storage through it.
const { blobs, teardownSpy, switchSpy, runInitSpy, fetchWsSpy } = vi.hoisted(() => ({
  blobs: new Map(),
  teardownSpy: vi.fn(async () => {}),
  switchSpy: vi.fn(async () => {}),
  runInitSpy: vi.fn(async () => {}),
  fetchWsSpy: vi.fn(async () => {}),
}));

vi.mock('@/lib/native/security', () => ({
  isEncryptionAvailable: vi.fn(async () => true),
  encryptString: vi.fn(async (s) => `cipher:${s}`),
  decryptString: vi.fn(async (s) => String(s).replace(/^cipher:/, '')),
  storeSecureBlob: vi.fn(async (k, v) => {
    blobs.set(k, v);
  }),
  fetchSecureBlob: vi.fn(async (k) => blobs.get(k) ?? null),
  clearSecureBlob: vi.fn(async (k) => {
    blobs.delete(k);
  }),
}));

// Only the live teardown is replaced: the rest of the composable (module state,
// activeId, the resets) stays real so this test exercises them.
vi.mock('@/composable/useCloudWorkspaces', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useCloudWorkspaces: () => ({
      ...actual.useCloudWorkspaces(),
      teardownLiveWorkspaceState: teardownSpy,
      fetchWorkspaces: fetchWsSpy,
    }),
  };
});

vi.mock('@/lib/native/workspaces', () => ({
  switchLocalWorkspace: switchSpy,
  listLocalWorkspaces: vi.fn(async () => []),
  getActiveLocalWorkspace: vi.fn(async () => null),
}));

vi.mock('@/composable/useAppShell', () => ({
  runWorkspaceInit: runInitSpy,
}));

vi.mock('@/utils/crypto/identity', () => ({
  loadOrCreateIdentity: vi.fn(async () => ({ publicKeyHex: 'pk', privateKeyHex: 'sk' })),
  publishIdentity: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@/utils/sync/shared-keys', () => ({
  clearSharedSyncKeys: vi.fn(async () => {}),
}));

import { useAccountAuth } from '@/composable/useAccountAuth';
import { useAccountStore } from '@/store/account';
import { useCloudWorkspaces, findWorkspaceAccount } from '@/composable/useCloudWorkspaces';
import { clearIndex, getActiveAccountId, saveIndex } from '@/lib/accounts-index';

let switchAccount = null;

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

async function seed(accounts = [PERSONAL, TEAM], activeAccountId = 'p1') {
  await saveIndex({ accounts, activeAccountId });
}

beforeEach(async () => {
  setActivePinia(createPinia());
  localStorage.clear();
  blobs.clear();
  vi.clearAllMocks();
  switchSpy.mockImplementation(async () => {});
  runInitSpy.mockImplementation(async () => {});
  fetchWsSpy.mockImplementation(async () => {});
  await clearIndex();
  useCloudWorkspaces().activeId.value = null;
  useCloudWorkspaces().workspaces.value = [];
  switchAccount = useAccountAuth().switchAccount;
  window.location.hash = '';
});

describe('switching account in place', () => {
  it('tears down, swaps, re-inits once and never reloads', async () => {
    await seed();
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});

    await switchAccount({ accountId: 't1', workspaceId: 'w-team' });

    expect(reload).not.toHaveBeenCalled();
    expect(teardownSpy).toHaveBeenCalledTimes(1);
    expect(switchSpy).toHaveBeenCalledWith('w-team');
    expect(runInitSpy).toHaveBeenCalledTimes(1);
    expect(getActiveAccountId()).toBe('t1');
    expect(useCloudWorkspaces().activeId.value).toBe('w-team');
  });

  it('flushes the leaving account before its pools are swapped', async () => {
    await seed();
    let accountAtSwap = null;
    switchSpy.mockImplementation(async () => {
      accountAtSwap = getActiveAccountId();
    });

    await switchAccount({ accountId: 't1', workspaceId: 'w-team' });

    // Still the leaving account: nothing the old account had pending can be
    // written under the arriving account's token.
    expect(accountAtSwap).toBe('p1');
    expect(teardownSpy.mock.invocationCallOrder[0]).toBeLessThan(
      switchSpy.mock.invocationCallOrder[0],
    );
  });

  it('switching to the same account and workspace is a no-op', async () => {
    await seed();
    await switchAccount({ accountId: 't1', workspaceId: 'w-team' });
    await switchAccount({ accountId: 't1', workspaceId: 'w-team' });

    expect(teardownSpy).toHaveBeenCalledTimes(1);
    expect(switchSpy).toHaveBeenCalledTimes(1);
    expect(runInitSpy).toHaveBeenCalledTimes(1);
  });

  it('a second switch during the first cannot interleave', async () => {
    await seed();
    const first = switchAccount({ accountId: 't1', workspaceId: 'w-team' });
    const second = switchAccount({ accountId: 'p1', workspaceId: 'w-personal' });
    await Promise.all([first, second]);

    expect(switchSpy).toHaveBeenCalledTimes(1);
    expect(runInitSpy).toHaveBeenCalledTimes(1);
  });

  it('drops the leaving workspace lists so the next account cannot paint them', async () => {
    await seed();
    useCloudWorkspaces().workspaces.value = [{ id: 'stale', name: 'Previous account' }];

    await switchAccount({ accountId: 't1', workspaceId: 'w-team' });

    expect(useCloudWorkspaces().workspaces.value).toEqual([]);
  });

  it('a failed pool swap keeps the current account and still switches later', async () => {
    await seed();
    switchSpy.mockRejectedValueOnce(new Error('workspace_switch failed'));

    const failed = await switchAccount({ accountId: 't1', workspaceId: 'w-team' });

    expect(failed.switched).toBe(false);
    expect(getActiveAccountId()).toBe('p1');

    const ok = await switchAccount({ accountId: 't1', workspaceId: 'w-team' });
    expect(ok.switched).toBe(true);
    expect(getActiveAccountId()).toBe('t1');
  });

  it('an account with no workspace of its own asks for its list first', async () => {
    await seed([PERSONAL, { id: 't1', email: 'team@test.test', workspaces: [] }], 'p1');
    fetchWsSpy.mockImplementation(async () => {
      const cloud = useCloudWorkspaces();
      cloud.workspaces.value = [{ id: 'w-fetched', name: 'Untitled Workspace' }];
      cloud.activeId.value = 'w-fetched';
    });

    await switchAccount({ accountId: 't1' });

    expect(switchSpy).toHaveBeenCalledWith('w-fetched');
    expect(useAccountStore().activeWorkspaceId).toBe('w-fetched');
  });

  it('falls back to the local default when the account has no workspace at all', async () => {
    await seed([PERSONAL, { id: 't1', email: 'team@test.test', workspaces: [] }], 'p1');

    await switchAccount({ accountId: 't1' });

    expect(switchSpy).toHaveBeenCalledWith('default');
  });

  it('leaves a note route for home so the arriving workspace is what shows', async () => {
    await seed();
    window.location.hash = '#/note/p9a0JhsEihdqx5OtIfb4G';

    await switchAccount({ accountId: 't1', workspaceId: 'w-team' });

    expect(window.location.hash).toBe('#/');
  });

  it('leaves every other route alone', async () => {
    await seed();
    window.location.hash = '#/settings/appearance';

    await switchAccount({ accountId: 't1', workspaceId: 'w-team' });

    expect(window.location.hash).toBe('#/settings/appearance');
  });
});

describe('findWorkspaceAccount', () => {
  it('names the owning account, and the active one for an unknown workspace', async () => {
    await seed();

    expect(findWorkspaceAccount('w-team')).toBe('t1');
    expect(findWorkspaceAccount('shared-note-workspace')).toBe('p1');
  });
});

describe('account store after a switch', () => {
  it('carries the arriving account credentials', async () => {
    await seed();
    const store = useAccountStore();
    store.token = 'personal-token';
    store.status = 'authenticated';

    await switchAccount({ accountId: 't1', workspaceId: 'w-team' });

    expect(store.activeAccountId).toBe('t1');
    expect(store.activeWorkspaceId).toBe('w-team');
    expect(store.token).toBe(null);
    expect(store.status).toBe('anonymous');
  });
});
