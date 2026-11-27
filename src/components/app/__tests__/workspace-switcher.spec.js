import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import WorkspaceSwitcher from '@/components/app/WorkspaceSwitcher.vue';
import { clearIndex, saveIndex } from '@/lib/accounts-index';

const { blobs, ctl, accountState } = vi.hoisted(() => ({
  blobs: new Map(),
  // Mutable so tests can flip the plan's dashboard flag.
  accountState: { planLimits: { flags: {} } },
  ctl: {
    confirm: vi.fn(),
    alert: vi.fn(),
    push: vi.fn(),
    switchAccount: vi.fn(async () => ({ switched: true })),
    signOutAccount: vi.fn(async () => ({ switched: true })),
    listArchived: vi.fn(async () => []),
    restoreLocal: vi.fn(async () => {}),
    renameLocal: vi.fn(async () => {}),
    updateDecoration: vi.fn(async () => ({})),
    storeRename: vi.fn(async () => {}),
  },
}));

vi.mock('@/lib/native/security', () => ({
  isEncryptionAvailable: vi.fn(async () => true),
  encryptString: vi.fn(async (value) => `cipher:${value}`),
  decryptString: vi.fn(async (value) => String(value).replace(/^cipher:/, '')),
  storeSecureBlob: vi.fn(async (key, value) => {
    blobs.set(key, value);
  }),
  fetchSecureBlob: vi.fn(async (key) => (blobs.has(key) ? blobs.get(key) : null)),
  clearSecureBlob: vi.fn(async (key) => {
    blobs.delete(key);
  }),
}));

vi.mock('@/lib/dialog', () => ({
  useDialog: () => ({ confirm: ctl.confirm, alert: ctl.alert }),
}));

vi.mock('@/lib/native/workspaces', () => ({
  listArchivedWorkspaces: ctl.listArchived,
  restoreLocalWorkspace: ctl.restoreLocal,
  renameLocalWorkspace: ctl.renameLocal,
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: ctl.push, replace: ctl.push }),
}));

vi.mock('@/store/account', () => ({
  useAccountStore: () => ({
    isAuthenticated: true,
    isPaidPlan: true,
    serverUrl: 'https://api.test',
    get planLimits() {
      return accountState.planLimits;
    },
  }),
}));

vi.mock('@/store/workspace', () => ({
  saveLocalWorkspaceDecoration: vi.fn(async () => {}),
  useWorkspaceStore: () => ({
    workspaces: [
      { id: 'ws1', name: 'Personal', role: 'owner' },
      { id: 'ws2', name: 'Beta', role: 'owner' },
    ],
    activeId: 'ws1',
    loading: false,
    retrieve: vi.fn(async () => {}),
    create: vi.fn(),
    rename: ctl.storeRename,
  }),
}));

vi.mock('@/composable/useCloudWorkspaces', () => ({
  useCloudWorkspaces: () => ({
    pendingRequests: ref([]),
    fetchMyPendingRequests: vi.fn(async () => []),
    joinWorkspace: vi.fn(async () => ({})),
    updateWorkspaceDecoration: ctl.updateDecoration,
  }),
}));

vi.mock('@/composable/useAccountAuth', () => ({
  switchAccount: ctl.switchAccount,
  signOutAccount: ctl.signOutAccount,
}));

const ACCOUNTS = [
  {
    id: 'p1',
    email: 'me@test.test',
    subscription: { plan: 'pro' },
    workspaces: [{ id: 'ws1', name: 'Personal', role: 'owner' }],
    activeWorkspaceId: 'ws1',
  },
  {
    id: 't1',
    email: 'team@test.test',
    // What sign-in/migration actually leave behind: no subscription object,
    // the plan only in planLimits.
    subscription: null,
    planLimits: { plan: 'team' },
    workspaces: [{ id: 'ws2', name: 'Beta', role: 'owner' }],
    activeWorkspaceId: 'ws2',
  },
];

// The real popover needs a portal; this stub renders both slots so the trigger
// and the list are in the DOM. Stubs render no default slot by default.
const popoverStub = { template: '<div><slot name="trigger" /><slot /></div>' };

let reload = null;

function mountSwitcher() {
  return mount(WorkspaceSwitcher, {
    props: { expanded: true },
    global: {
      stubs: {
        'ui-popover': popoverStub,
        'ui-button': true,
        'ui-input': true,
        'v-remixicon': true,
        WorkspaceFormDialog: true,
      },
      directives: { tooltip: {} },
    },
  });
}

describe('WorkspaceSwitcher accounts', () => {
  beforeEach(async () => {
    localStorage.clear();
    blobs.clear();
    vi.clearAllMocks();
    accountState.planLimits = { flags: {} };
    ctl.switchAccount.mockImplementation(async () => ({ switched: true }));
    ctl.signOutAccount.mockImplementation(async () => ({ switched: true }));
    ctl.confirm.mockReset();
    ctl.listArchived.mockImplementation(async () => []);
    ctl.restoreLocal.mockImplementation(async () => {});
    reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, hash: '', reload });
    await clearIndex();
    await saveIndex({ accounts: ACCOUNTS, activeAccountId: 'p1' });
  });

  it('lists every account with its plan and nests the active workspaces', async () => {
    const wrapper = mountSwitcher();
    await flushPromises();

    expect(wrapper.findAll('[data-testid="account-option"]')).toHaveLength(1);
    expect(wrapper.findAll('[data-testid="account-option-active"]')).toHaveLength(1);
    expect(wrapper.text()).toContain('me@test.test');
    expect(wrapper.text()).toContain('team@test.test');
    expect(wrapper.text()).toContain('pro');
    expect(wrapper.text()).toContain('team');
    expect(wrapper.find('[data-testid="workspace-option-active"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="workspace-option"]').exists()).toBe(true);
  });

  it('shows customize for owners but gates the gear on the dashboard flag', async () => {
    const wrapper = mountSwitcher();
    await flushPromises();

    // Free/pro plans have no dashboard, so team settings is unreachable.
    expect(wrapper.find('[aria-label="Customize Personal"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Team settings for Personal"]').exists()).toBe(
      false,
    );
    // Team/enterprise plans carry flags.dashboard from GET /plans.
    accountState.planLimits = { flags: { dashboard: true } };
    expect(wrapper.vm.canManageWorkspace({ role: 'owner' })).toBe(true);
    expect(wrapper.vm.canManageWorkspace({ role: 'admin' })).toBe(true);
    expect(wrapper.vm.canManageWorkspace({ role: 'editor' })).toBe(false);
  });

  it('switching account goes through switchAccount without a reload', async () => {
    const wrapper = mountSwitcher();
    await flushPromises();

    await wrapper.find('[data-testid="account-option"]').trigger('click');
    await flushPromises();

    expect(ctl.switchAccount).toHaveBeenCalledWith({ accountId: 't1' });
    expect(reload).not.toHaveBeenCalled();
  });

  it('switching workspace stays in place too', async () => {
    const wrapper = mountSwitcher();
    await flushPromises();

    await wrapper.find('[data-testid="workspace-option"]').trigger('click');
    await flushPromises();

    expect(ctl.switchAccount).toHaveBeenCalledWith({
      accountId: 'p1',
      workspaceId: 'ws2',
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it('lists a deleted local workspace and restores it in place', async () => {
    ctl.listArchived.mockImplementation(async () => [
      { id: 'default', name: 'Default', archivedAt: new Date().toISOString() },
    ]);
    const wrapper = mountSwitcher();
    await flushPromises();

    expect(wrapper.text()).toContain('Deleted (restorable 10 days)');

    await wrapper.find('[aria-label="Restore Default"]').trigger('click');
    await flushPromises();

    expect(ctl.restoreLocal).toHaveBeenCalledWith('default');
  });

  it('renames a local workspace without touching the cloud', async () => {
    const wrapper = mountSwitcher();
    await flushPromises();

    wrapper.vm.formDialogMode = 'edit';
    wrapper.vm.formDialogWorkspace = { id: 'ws-local', name: 'Old', local: true };
    await wrapper.vm.handleFormConfirm({ name: 'New', emoji: '📁', color: null });

    expect(ctl.renameLocal).toHaveBeenCalledWith('ws-local', 'New');
    expect(ctl.storeRename).not.toHaveBeenCalled();
  });

  it('routes a cloud edit through decoration and rename', async () => {
    const wrapper = mountSwitcher();
    await flushPromises();

    wrapper.vm.formDialogMode = 'edit';
    wrapper.vm.formDialogWorkspace = { id: 'ws1', name: 'Personal' };
    await wrapper.vm.handleFormConfirm({ name: 'New', emoji: '📁', color: null });

    expect(ctl.updateDecoration).toHaveBeenCalledWith('ws1', {
      emoji: '📁',
      color: null,
    });
    expect(ctl.storeRename).toHaveBeenCalledWith('ws1', 'New');
    expect(ctl.renameLocal).not.toHaveBeenCalled();
  });

  it('lets local workspaces customize but not manage', () => {
    const wrapper = mountSwitcher();

    expect(wrapper.vm.canCustomizeWorkspace({ name: 'L', local: true })).toBe(
      true,
    );
    expect(wrapper.vm.canManageWorkspace({ name: 'L', local: true })).toBe(
      false,
    );
    expect(wrapper.vm.canCustomizeWorkspace({ name: 'C', role: 'editor' })).toBe(
      false,
    );
    expect(wrapper.vm.canCustomizeWorkspace({ name: 'C', role: 'admin' })).toBe(
      true,
    );
  });

  it('asks before signing an account out', async () => {
    let confirmOptions = null;
    ctl.confirm.mockImplementation((options) => {
      confirmOptions = options;
    });
    const wrapper = mountSwitcher();
    await flushPromises();

    await wrapper.find('[data-testid="account-signout"]').trigger('click');
    expect(ctl.signOutAccount).not.toHaveBeenCalled();
    expect(confirmOptions?.title).toBe('Sign out?');

    await confirmOptions.onConfirm();
    expect(ctl.signOutAccount).toHaveBeenCalledWith('p1');
  });

  it('add account opens the sign-in form on the account page', async () => {
    const wrapper = mountSwitcher();
    await flushPromises();

    await wrapper.find('[data-testid="add-account"]').trigger('click');

    expect(ctl.push).toHaveBeenCalledWith({
      path: '/settings/account',
      query: { addAccount: '1' },
    });
  });
});
