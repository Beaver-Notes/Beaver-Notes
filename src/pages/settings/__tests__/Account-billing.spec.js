import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import emitter from 'tiny-emitter/instance';

const ctl = vi.hoisted(() => ({
  paid: false,
  storage: null,
  routeQuery: {},
}));

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: ctl.routeQuery }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(async () => {}) }),
  createRouter: vi.fn(() => ({
    beforeEach: vi.fn(),
    afterEach: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
  })),
  createWebHashHistory: vi.fn(() => ({})),
}));

vi.mock('@/lib/dialog', () => ({
  useDialog: () => ({ alert: vi.fn(), confirm: vi.fn(), prompt: vi.fn() }),
}));

vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({ translations: ref({}) }),
}));

vi.mock('@/lib/tauri/runtime', () => ({
  isMobileRuntime: () => true,
  isIOSRuntime: () => false,
  isMacOSRuntime: () => false,
}));

vi.mock('@/store/account', () => ({
  useAccountStore: () => ({
    isAnonymous: false,
    isAuthenticated: true,
    get isPaidPlan() {
      return ctl.paid;
    },
    get plan() {
      return ctl.paid ? 'pro' : 'free';
    },
    profile: { id: 'u1' },
    serverUrl: 'https://api.test',
    get subscription() {
      return { plan: ctl.paid ? 'pro' : 'free', storage: ctl.storage };
    },
    get storageUsedPercent() {
      return 0;
    },
    devices: [],
    busy: false,
    error: '',
    seedProgress: {},
    setError: vi.fn(),
    setServerUrl: () => true,
  }),
}));

vi.mock('@/composable/useSettingsAccount', () => ({
  useSettingsAccount: () => ({
    sessions: ref([]),
    loadingSessions: ref(false),
    loadSessions: vi.fn(),
    revokeSession: vi.fn(),
    exportAccountData: vi.fn(),
    triggerSeed: vi.fn(),
    saveServerUrl: vi.fn(),
    resetServerUrl: vi.fn(),
    clearError: vi.fn(),
  }),
}));

import Account from '../Account.vue';

describe('Account paywall wiring (source)', () => {
  const src = () => readFileSync('src/pages/settings/Account.vue', 'utf8');

  it('routes the upgrade row through the shared PaywallDialog', () => {
    expect(src()).toMatch(/openPaywall\('settings'\)/);
    expect(src()).not.toMatch(/SubscriptionDialog/);
  });

  it('opens the paywall from the storage banner and the cloud-sync CTA', () => {
    expect(src()).toMatch(/openPaywall\('storage'\)/);
    expect(src()).toMatch(/openPaywall\('sync'\)/);
  });

  it('no longer picks plan+interval inline (paywall owns that choice)', () => {
    expect(src()).not.toMatch(/opt\.plan !== 'team'/);
    expect(src()).not.toMatch(/handleIapSelect|handleIapRestore|billingOptions/);
  });

  it('keeps the manage-billing URL guard', () => {
    expect(src()).toMatch(/isAllowedBillingUrl/);
    expect(src()).toMatch(/createPortalSession/);
  });
});

describe('Account paywall CTA (mounted)', () => {
  const reasons = [];
  const onPaywall = ({ reason } = {}) => reasons.push(reason);

  beforeEach(() => {
    ctl.paid = false;
    ctl.storage = null;
    ctl.routeQuery = {};
    reasons.length = 0;
    emitter.on('show-paywall', onPaywall);
  });

  afterEach(() => {
    emitter.off('show-paywall', onPaywall);
  });

  const mountAccount = () =>
    mount(Account, {
      global: {
        stubs: {
          'ui-input': true,
          'ui-button': { template: '<button data-testid="primary-cta"><slot /></button>' },
          'ui-modal': { template: '<div><slot /></div>' },
          'ui-card': { template: '<div><slot /></div>' },
          'ui-banner': {
            template:
              '<div><slot /><button data-testid="banner-primary" @click="$emit(\'button-1\')" /></div>',
          },
          'v-remixicon': true,
        },
      },
    });

  it('free users get a CTA that opens the paywall with reason settings', async () => {
    const w = mountAccount();
    await flushPromises();
    const upgrade = w.find('[data-testid="upgrade-choose-plan"]');
    expect(upgrade.exists()).toBe(true);
    await upgrade.trigger('click');
    expect(reasons).toEqual(['settings']);
  });

  it('warns above 85% storage and opens the paywall from the banner', async () => {
    ctl.paid = true;
    ctl.storage = { usedBytes: 90, quotaBytes: 100 };
    const w = mountAccount();
    await flushPromises();
    expect(w.vm.storageNearLimit).toBe(true);
    expect(w.find('[data-testid="storage-quota-warning"]').exists()).toBe(true);
    await w.find('[data-testid="banner-primary"]').trigger('click');
    expect(reasons).toEqual(['storage']);
  });

  it('does not warn below the storage threshold', async () => {
    ctl.paid = true;
    ctl.storage = { usedBytes: 10, quotaBytes: 100 };
    const w = mountAccount();
    await flushPromises();
    expect(w.vm.storageNearLimit).toBe(false);
    expect(w.find('[data-testid="storage-quota-warning"]').exists()).toBe(false);
  });

  it('deep link ?upgrade=pro lands on the paywall', async () => {
    ctl.routeQuery = { upgrade: 'pro' };
    mountAccount();
    await flushPromises();
    expect(reasons).toEqual(['settings']);
  });

  it('free users get a cloud-sync CTA that opens the paywall with reason sync', async () => {
    const w = mountAccount();
    await flushPromises();
    const cta = w.find('[data-testid="cloud-sync-upgrade"]');
    expect(cta.exists()).toBe(true);
    await cta.trigger('click');
    expect(reasons).toEqual(['sync']);
  });
});
