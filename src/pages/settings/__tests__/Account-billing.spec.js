import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

const iapCtl = vi.hoisted(() => ({
  buyImpl: null,
  restoreImpl: null,
  paid: false,
  alert: null,
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(async () => {}) }),
}));

vi.mock('@/lib/dialog', () => ({
  useDialog: () => ({ alert: (...a) => iapCtl.alert?.(...a), confirm: vi.fn(), prompt: vi.fn() }),
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
      return iapCtl.paid;
    },
    plan: iapCtl.paid ? 'pro' : 'free',
    profile: { id: 'u1' },
    serverUrl: 'https://api.test',
    subscription: { plan: iapCtl.paid ? 'pro' : 'free' },
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
    signInEmail: ref(''),
    signInPassword: ref(''),
    signUpUsername: ref(''),
    passkeyEmail: ref(''),
    quickConnectCode: ref(''),
    quickConnectSecret: ref(''),
    quickConnectExpiresAt: ref(null),
    showPasswordAuth: ref(false),
    showQuickConnect: ref(false),
    showServerUrlEditor: ref(false),
    draftServerUrl: ref('https://api.test'),
    defaultServerUrl: 'https://api.test',
    deletingAccount: ref(false),
    deletePassword: ref(''),
    saveServerUrl: vi.fn(),
    resetServerUrl: vi.fn(),
    handleSignInWithPassword: vi.fn(),
    handleSignUpWithPassword: vi.fn(),
    handleSignInWithPasskey: vi.fn(),
    handleSignUpWithPasskey: vi.fn(),
    startQuickConnect: vi.fn(),
    pollQuickConnect: vi.fn(),
    authorizeQuickConnect: vi.fn(),
    handleSignOut: vi.fn(),
    handleSignOutEverywhere: vi.fn(),
    handleRevokeDevice: vi.fn(),
    openDeleteAccount: vi.fn(),
    cancelDeleteAccount: vi.fn(),
    confirmDeleteAccount: vi.fn(),
    clearError: vi.fn(),
    triggerSeed: vi.fn(),
    editingUsername: ref(false),
    draftUsername: ref(''),
    startEditUsername: vi.fn(),
    cancelEditUsername: vi.fn(),
    saveUsername: vi.fn(),
    sessions: ref([]),
    loadingSessions: ref(false),
    loadSessions: vi.fn(),
    revokeSession: vi.fn(),
    exportAccountData: vi.fn(),
  }),
}));

vi.mock('@/composable/useIapBilling', () => ({
  useIapBilling: () => ({
    products: ref([]),
    loading: ref(false),
    error: ref(''),
    loadProducts: vi.fn(),
    openManage: vi.fn(),
    buy: (...a) => iapCtl.buyImpl(...a),
    restore: (...a) => iapCtl.restoreImpl(...a),
  }),
}));

import Account from '../Account.vue';

describe('Account mobile billing wiring', () => {
  it('routes upgrades through SubscriptionDialog on mobile', () => {
    const src = readFileSync('src/pages/settings/Account.vue', 'utf8');
    expect(src).toMatch(/SubscriptionDialog/);
    expect(src).toMatch(/showPlansDialog/);
  });
  it('hides team rows on mobile', () => {
    const src = readFileSync('src/pages/settings/Account.vue', 'utf8');
    expect(src).toMatch(/opt\.plan !== 'team'/);
  });
  it('handles IAP purchase async with busy + processing feedback', () => {
    const src = readFileSync('src/pages/settings/Account.vue', 'utf8');
    expect(src).toMatch(/handleIapSelect/);
    expect(src).toMatch(/iapBusy/);
    expect(src).toMatch(/await iap\.buy\(/);
    expect(src).toMatch(/Payment processing — your plan will activate shortly/);
  });
  it('wires restore purchases through iap.restore', () => {
    const src = readFileSync('src/pages/settings/Account.vue', 'utf8');
    expect(src).toMatch(/handleIapRestore/);
    expect(src).toMatch(/await iap\.restore\(\)/);
    expect(src).toMatch(/@restore/);
  });
  it('gates restore success on paid plan', () => {
    const src = readFileSync('src/pages/settings/Account.vue', 'utf8');
    expect(src).toMatch(/if \(accountStore\.isPaidPlan\)/);
    expect(src).toMatch(/No purchases found for this account\./);
  });
});

describe('Account IAP handlers (mounted)', () => {
  beforeEach(() => {
    iapCtl.paid = false;
    iapCtl.alert = vi.fn();
    iapCtl.buyImpl = async () => 'pro';
    iapCtl.restoreImpl = async () => {};
  });

  const mountAccount = () =>
    mount(Account, {
      global: {
        stubs: {
          'ui-input': true,
          'ui-button': { template: '<button><slot /></button>' },
          'ui-modal': { template: '<div><slot /></div>' },
          'ui-card': true,
          'v-remixicon': true,
          SubscriptionDialog: { template: '<div />' },
        },
      },
    });

  it('buy resolving a plan closes the dialog with a success message', async () => {
    iapCtl.buyImpl = async () => 'pro';
    const w = mountAccount();
    await flushPromises();
    w.vm.showPlansDialog = true;
    await w.vm.handleIapSelect('pro', 'monthly');
    expect(w.vm.billingMessage).toMatch(/Subscribed to pro/);
    expect(w.vm.billingSuccess).toBe(true);
    expect(w.vm.showPlansDialog).toBe(false);
    expect(w.vm.iapBusy).toBe(false);
  });

  it('buy resolving null keeps the dialog open with a processing message', async () => {
    iapCtl.buyImpl = async () => null;
    const w = mountAccount();
    await flushPromises();
    w.vm.showPlansDialog = true;
    await w.vm.handleIapSelect('pro', 'monthly');
    expect(w.vm.billingMessage).toMatch(/Payment processing/);
    expect(w.vm.billingSuccess).toBe(false);
    expect(w.vm.showPlansDialog).toBe(true);
    expect(w.vm.iapBusy).toBe(false);
  });

  it('buy throwing surfaces the error and resets success', async () => {
    iapCtl.buyImpl = async () => {
      throw new Error('card declined');
    };
    const w = mountAccount();
    await flushPromises();
    await w.vm.handleIapSelect('pro', 'monthly');
    expect(w.vm.billingError).toBe('card declined');
    expect(w.vm.billingSuccess).toBe(false);
    expect(w.vm.iapBusy).toBe(false);
    expect(iapCtl.alert).toHaveBeenCalled();
  });

  it('restore closes the dialog only when paid', async () => {
    iapCtl.paid = true;
    const w = mountAccount();
    await flushPromises();
    w.vm.showPlansDialog = true;
    await w.vm.handleIapRestore();
    expect(w.vm.billingMessage).toMatch(/Purchases restored/);
    expect(w.vm.billingSuccess).toBe(true);
    expect(w.vm.showPlansDialog).toBe(false);
    expect(w.vm.iapBusy).toBe(false);
  });

  it('restore with nothing owned stays open with a neutral message', async () => {
    iapCtl.paid = false;
    const w = mountAccount();
    await flushPromises();
    w.vm.showPlansDialog = true;
    await w.vm.handleIapRestore();
    expect(w.vm.billingMessage).toMatch(/No purchases found/);
    expect(w.vm.billingSuccess).toBe(false);
    expect(w.vm.showPlansDialog).toBe(true);
    expect(w.vm.iapBusy).toBe(false);
  });
});
