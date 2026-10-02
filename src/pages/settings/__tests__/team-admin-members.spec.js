import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';

const routerPush = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('vue-router', () => ({
  useRouter: () => routerPush,
}));

const dialogCalls = vi.hoisted(() => ({ confirm: [] }));
vi.mock('@/lib/dialog', () => ({
  useDialog: () => ({
    confirm: (opts) => { dialogCalls.confirm.push(opts); },
    alert: vi.fn(),
    prompt: vi.fn(),
  }),
}));

const adminMock = vi.hoisted(() => ({
  members: [],
  removeMember: null,
  revoke: null,
}));

vi.mock('@/composable/useTeamAdmin', async () => {
  const { ref: r } = await import('vue');
  adminMock.removeMember = vi.fn().mockResolvedValue({});
  adminMock.revoke = vi.fn().mockResolvedValue({});
  return {
    useTeamAdmin: () => ({
      members: r(adminMock.members),
      devices: r([]),
      sessions: r([]),
      auditLogs: r([]),
      joinRequests: r([]),
      error: r(''),
      loadMembers: vi.fn().mockResolvedValue({}),
      loadDevices: vi.fn().mockResolvedValue({}),
      loadJoinRequests: vi.fn().mockResolvedValue({}),
      removeMember: adminMock.removeMember,
      revoke: adminMock.revoke,
      revokeSession: adminMock.revoke,
    }),
  };
});

vi.mock('@/lib/api/plans', () => ({
  getPlans: vi.fn(async () => ({
    plan: 'team',
    flags: { dashboard: true, audit: false },
    quotaBytes: 0,
    historyDays: null,
  })),
}));

vi.mock('@/lib/api/sso', () => ({
  listSsoConfigs: vi.fn(async () => []),
  createSsoConfig: vi.fn(),
  updateSsoConfig: vi.fn(),
  deleteSsoConfig: vi.fn(),
}));

vi.mock('@/store/account', () => ({
  useAccountStore: () => ({
    activeAccount: null,
    profile: { id: 'owner-id' },
    serverUrl: 'https://api.test',
  }),
}));

vi.mock('@/store/workspace', () => ({
  useWorkspaceStore: () => ({ activeId: 'ws-1' }),
}));

vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({ translations: ref({}) }),
}));

import { getPlans } from '@/lib/api/plans';
import TeamAdmin from '../TeamAdmin.vue';

const MEMBER = {
  userId: 'uuid-1',
  username: 'alice',
  email: 'alice@example.com',
  role: 'editor',
  deviceCount: 2,
  lastSeen: null,
  createdAt: null,
};

function mountAdmin() {
  return mount(TeamAdmin, {
    global: {
      stubs: {
        'ui-input': true,
        'ui-select': true,
        'ui-button': { template: '<button type="button"><slot /></button>' },
        'v-remixicon': true,
      },
    },
  });
}

describe('TeamAdmin member identity', () => {
  beforeEach(() => {
    dialogCalls.confirm.length = 0;
    adminMock.members = [MEMBER];
    adminMock.removeMember.mockClear();
    adminMock.revoke.mockClear();
  });

  it('offers an Upgrade CTA on the plan gate that preselects Team', async () => {
    getPlans.mockResolvedValueOnce({
      plan: 'free',
      flags: { dashboard: false, audit: false },
      quotaBytes: 0,
      historyDays: null,
    });
    routerPush.push.mockClear();
    const wrapper = mountAdmin();
    await flushPromises();

    const upgrade = wrapper
      .findAll('button')
      .find((b) => b.text().includes('Upgrade'));
    expect(upgrade).toBeTruthy();

    await upgrade.trigger('click');
    expect(routerPush.push).toHaveBeenCalledWith({
      path: '/settings/account',
      query: { upgrade: 'team' },
    });
  });

  it('renders the member by username, never their email or the raw UUID', async () => {
    const wrapper = mountAdmin();
    await flushPromises();

    expect(wrapper.text()).toContain('alice');
    expect(wrapper.text()).not.toContain('alice@example.com');
    expect(wrapper.text()).not.toContain('uuid-1');
    expect(wrapper.find('[title="uuid-1"]').exists()).toBe(true);
  });

  it('falls back to the userId, never the email, when a member has no username', async () => {
    adminMock.members = [{ ...MEMBER, username: null }];
    const wrapper = mountAdmin();
    await flushPromises();

    expect(wrapper.text()).toContain('uuid-1');
    expect(wrapper.text()).not.toContain('alice@example.com');
  });

  it('confirms before removing a member and names them', async () => {
    const wrapper = mountAdmin();
    await flushPromises();

    wrapper.vm.handleRemoveMember(MEMBER);

    expect(dialogCalls.confirm).toHaveLength(1);
    expect(dialogCalls.confirm[0].title).toContain('alice');
    expect(adminMock.removeMember).not.toHaveBeenCalled();

    await dialogCalls.confirm[0].onConfirm();
    expect(adminMock.removeMember).toHaveBeenCalledWith('uuid-1');
  });

  it('confirms before revoking a session and labels it with the device', async () => {
    adminMock.members = [];
    const wrapper = mountAdmin();
    await flushPromises();

    const session = { idHash: 'h1', deviceLabel: 'Work MacBook', deviceId: 'dev-1' };
    wrapper.vm.handleRevoke(session);

    expect(dialogCalls.confirm).toHaveLength(1);
    expect(dialogCalls.confirm[0].title).toContain('Work MacBook');
    expect(adminMock.revoke).not.toHaveBeenCalled();

    await dialogCalls.confirm[0].onConfirm();
    expect(adminMock.revoke).toHaveBeenCalledWith('h1');
  });
});
