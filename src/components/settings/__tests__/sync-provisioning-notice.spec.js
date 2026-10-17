import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';

const ctl = vi.hoisted(() => ({ issue: null, retry: vi.fn() }));

vi.mock('@/composable/useCloudWorkspaces', async () => {
  const { ref } = await import('vue');
  return {
    useCloudWorkspaces: () => ({
      provisioningIssue: ref(ctl.issue),
      retryProvisioning: ctl.retry,
    }),
  };
});

vi.mock('@/composable/useTranslations', async () => {
  const { ref } = await import('vue');
  return { useTranslations: () => ({ translations: ref({ settings: {} }) }) };
});

import SyncProvisioningNotice from '../SyncProvisioningNotice.vue';

function mountNotice() {
  return mount(SyncProvisioningNotice, {
    global: {
      stubs: {
        'ui-button': { template: '<button type="button"><slot /></button>' },
      },
    },
  });
}

describe('SyncProvisioningNotice', () => {
  beforeEach(() => {
    ctl.issue = null;
    ctl.retry.mockReset();
  });

  it('renders nothing when the device is fully synced', () => {
    const wrapper = mountNotice();
    expect(wrapper.find('[data-testid="sync-provisioning-notice"]').exists()).toBe(false);
  });

  it('shows the waiting-for-key notice with a Retry action that retries provisioning', async () => {
    ctl.issue = 'not-synced';
    const wrapper = mountNotice();

    const notice = wrapper.get('[data-testid="sync-provisioning-notice"]');
    expect(notice.text()).toContain("isn't fully synced");

    await wrapper.get('[data-testid="provisioning-retry"]').trigger('click');
    expect(ctl.retry).toHaveBeenCalledTimes(1);
  });

  it('shows the refused-device-key case as a distinct, more serious line', () => {
    ctl.issue = 'key-changed';
    const wrapper = mountNotice();

    const notice = wrapper.get('[data-testid="sync-provisioning-notice"]');
    expect(notice.text()).toContain('key changed');
    expect(notice.text()).not.toContain("isn't fully synced");
    expect(notice.attributes('role')).toBe('alert');
  });
});
