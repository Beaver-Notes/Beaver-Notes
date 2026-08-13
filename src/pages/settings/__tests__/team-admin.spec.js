import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { ref } from 'vue';

vi.mock('@/composable/useTeamAdmin', () => ({
  useTeamAdmin: () => ({
    members: ref([{ userId: 'u1', role: 'editor', deviceCount: 2, lastSeen: null }]),
    devices: ref([]),
    auditLogs: ref([]),
    loading: ref(false),
    error: ref(''),
    loadMembers: vi.fn(),
    loadDevices: vi.fn(),
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

  it('renders members and a locked audit tab on team plan', async () => {
    const wrapper = mount(TeamAdmin, {
      global: { stubs: ['ui-button', 'ui-input', 'ui-card', 'v-remixicon'] },
    });
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('u1');
    expect(wrapper.text()).toContain('Audit');
  });
});
