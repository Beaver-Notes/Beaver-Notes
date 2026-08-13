import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { ref } from 'vue';

vi.mock('@/composable/useTeamAdmin', () => ({
  useTeamAdmin: () => ({
    members: ref([{ userId: 'u1', role: 'editor', deviceCount: 2, lastSeen: null }]),
    devices: ref([]),
    sessions: ref([{ idHash: 's1', deviceLabel: 'MacBook', deviceId: 'dev-1', lastSeenAt: '2026-01-01', revoked: false }]),
    auditLogs: ref([]),
    loading: ref(false),
    error: ref(''),
    loadMembers: vi.fn().mockResolvedValue(),
    loadDevices: vi.fn().mockResolvedValue(),
    loadAudit: vi.fn(),
    addMemberByEmail: vi.fn(),
    generateInviteLink: vi.fn(),
    changeRole: vi.fn(),
    removeMember: vi.fn(),
    revoke: vi.fn(),
  }),
}));

vi.mock('@/lib/api/plans', () => ({
  getPlans: vi.fn(async () => ({ plan: 'team', flags: { dashboard: true, audit: false }, quotaBytes: 125 * 1024 ** 3, historyDays: 365, deviceLimit: null })),
}));

import TeamAdmin from '../TeamAdmin.vue';

describe('TeamAdmin.vue', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('renders members, sessions and a locked audit tab on team plan', async () => {
    const wrapper = mount(TeamAdmin, {
      global: { stubs: ['ui-button', 'ui-input', 'ui-select', 'ui-card', 'v-remixicon'] },
    });
    await flushPromises();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('u1');
    expect(wrapper.text()).toContain('MacBook');
    expect(wrapper.text()).toContain('Audit');
    expect(wrapper.text()).toContain('GB pooled');
    expect(wrapper.text()).toContain('365 days');
  });

  it('shows an upgrade empty-state when the dashboard flag is off', async () => {
    const getPlans = (await import('@/lib/api/plans')).getPlans;
    getPlans.mockResolvedValueOnce({ plan: 'pro', flags: { dashboard: false, audit: false }, quotaBytes: 50 * 1024 ** 3, historyDays: 365, deviceLimit: null });
    const wrapper = mount(TeamAdmin, {
      global: { stubs: ['ui-button', 'ui-input', 'ui-select', 'ui-card', 'v-remixicon'] },
    });
    await flushPromises();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Team dashboard requires the Team or Enterprise plan');
    expect(wrapper.text()).not.toContain('MacBook');
  });
});
