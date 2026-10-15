import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import WorkspaceSwitcher from '@/components/app/WorkspaceSwitcher.vue';
import { clearIndex, saveIndex } from '@/lib/accounts-index';

const { blobs, ctl } = vi.hoisted(() => ({
  blobs: new Map(),
  ctl: {
    confirm: vi.fn(),
    alert: vi.fn(),
    push: vi.fn(),
    switchAccount: vi.fn(async () => ({ switched: true })),
    signOutAccount: vi.fn(async () => ({ switched: true })),
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

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: ctl.push, replace: ctl.push }),
}));

vi.mock('@/store/account', () => ({
  useAccountStore: () => ({
    isAuthenticated: true,
    isPaidPlan: true,
    serverUrl: 'https://api.test',
    planLimits: { flags: {} },
  }),
}));

vi.mock('@/store/workspace', () => ({
  useWorkspaceStore: () => ({
    workspaces: [
      { id: 'ws1', name: 'Personal', role: 'owner' },
      { id: 'ws2', name: 'Beta', role: 'owner' },
    ],
    activeId: 'ws1',
    loading: false,
    retrieve: vi.fn(async () => {}),
    create: vi.fn(),
    rename: vi.fn(),
  }),
}));

vi.mock('@/composable/useCloudWorkspaces', () => ({
  useCloudWorkspaces: () => ({
    pendingRequests: ref([]),
    fetchMyPendingRequests: vi.fn(async () => []),
    joinWorkspace: vi.fn(async () => ({})),
  }),
}));

vi.mock('@/lib/api/plans', () => ({
  getPlans: vi.fn(async () => ({ flags: {} })),
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
    subscription: { plan: 'team' },
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
    ctl.switchAccount.mockImplementation(async () => ({ switched: true }));
    ctl.signOutAccount.mockImplementation(async () => ({ switched: true }));
    ctl.confirm.mockReset();
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
    expect(wrapper.find('[data-testid="workspace-option-active"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="workspace-option"]').exists()).toBe(true);
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
