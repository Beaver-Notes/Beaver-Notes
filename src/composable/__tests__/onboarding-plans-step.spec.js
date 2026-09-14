import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

const mobileFlag = vi.hoisted(() => ({ value: false }));
const iapCtl = vi.hoisted(() => ({ buyImpl: null, restoreImpl: null, paid: true, authed: true }));

vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({ translations: ref({}) }),
}));

vi.mock('@/composable/useTheme', () => ({
  useTheme: () => ({ loadTheme: vi.fn() }),
}));

vi.mock('@/composable/useOnboardingAppearance', () => ({
  useOnboardingAppearance: () => ({
    isDark: ref(false),
    themes: [],
    fonts: [],
    languages: [],
    themeLabels: {},
    selectTheme: vi.fn(),
    selectAccentColor: vi.fn(),
    selectFont: vi.fn(),
    selectLanguage: vi.fn(),
    selectSounds: vi.fn(),
    selectSpotlight: vi.fn(),
    selectZoomLevel: vi.fn(),
    prepareFreshWorkspace: vi.fn(),
    useDefaultPreferences: vi.fn(),
  }),
}));

vi.mock('@/lib/settings', () => ({
  DEFAULT_UI_FONT_STACK: "'Inter'",
  getSetting: vi.fn(async () => null),
  getSettingSync: vi.fn(() => null),
  invalidateSettingMirrors: vi.fn(),
  setSetting: vi.fn(async () => {}),
}));

vi.mock('@/store/account', () => ({
  useAccountStore: () => ({
    get isAuthenticated() {
      return iapCtl.authed;
    },
    get isPaidPlan() {
      return iapCtl.paid;
    },
    canUseCloudSync: true,
    serverUrl: 'https://api.test',
    status: 'authenticated',
    subscription: { plan: 'team' },
    profile: { id: 'u1' },
    seedProgress: {},
    setProfile: vi.fn(),
    setSubscription: vi.fn(),
    setDevices: vi.fn(),
    setSeedStatus: vi.fn(),
    setSeedProgress: vi.fn(),
  }),
}));

vi.mock('@/utils/onboarding/index.js', () => ({
  applyOnboardingSyncPreferences: vi.fn(async () => {}),
  getOnboardingMigrationStatus: vi.fn(async () => ({ hasLegacyData: false })),
  markOnboardingCompleted: vi.fn(async () => {}),
  probeCustomMigrationPath: vi.fn(async () => ({ hasLegacyData: false })),
  runOnboardingMigration: vi.fn(async () => {}),
  runOnboardingMigrationFromPath: vi.fn(async () => {}),
  ENTRANCE_DELAYS: { logo: 120, text: 580, cta: 1020 },
  CURTAIN_DURATIONS: { in: 420, out: 320, hold: 0, open: 0 },
}));

vi.mock('@/utils/crypto/encryption.js', () => ({
  setupEncryption: vi.fn(async () => ({ ok: true })),
  hasRemoteVaultKeyParams: vi.fn(async () => false),
  adoptVaultKey: vi.fn(async () => ({ ok: true })),
  isKeyLoaded: vi.fn(() => false),
}));

vi.mock('@/composable/useAccountAuth', () => ({
  useAccountAuth: () => ({ triggerSeed: vi.fn(() => Promise.resolve()) }),
}));

vi.mock('@/utils/onboarding/sync-policy.js', () => ({
  getOnboardingSyncTransport: vi.fn(() => 'remote'),
}));

vi.mock('@/utils/sync/path.js', () => ({
  setSyncPath: vi.fn(async () => {}),
}));

vi.mock('@/utils/sync/rust-shim.js', () => ({
  kickRustSync: vi.fn(() => true),
  startRustSync: vi.fn(async () => {}),
}));

vi.mock('@/utils/onboarding/import-finalize.js', () => ({
  buildImportedSearchIndex: vi.fn(async () => {}),
  secureImportedAssets: vi.fn(async () => {}),
}));

vi.mock('@/utils/onboarding/remote-vault-join.js', () => ({
  detectRemoteVaultJoin: vi.fn(async () => false),
  completeRemoteVaultJoin: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@/utils/migration/legacyElectron.js', () => ({
  detectLegacyLockedNotes: vi.fn(async () => ({ hasLocked: false, count: 0 })),
  validateLegacyLockedPassword: vi.fn(async () => ({ ok: true, count: 0 })),
}));

vi.mock('@/utils/onboarding/platforms.js', () => ({
  ALL_PLATFORMS: [],
  ONBOARDING_IMPORT_SOURCE_MAP: {},
  PLATFORM_LABELS: {},
  getMigrationSourceCopy: vi.fn(() => null),
  getMigrationWhatGetsCopied: vi.fn(() => null),
}));

vi.mock('@/lib/native/dialog', () => ({ openDialog: vi.fn(async () => ({ canceled: true })) }));

vi.mock('@/lib/tauri-bridge', () => ({
  backend: {
    isMobileRuntime: () => mobileFlag.value,
    invoke: vi.fn(async () => {}),
    listenPayload: vi.fn(async () => () => {}),
    listen: vi.fn(),
  },
  clipboard: {},
  addCloseHandler: vi.fn(),
  path: { join: (...p) => p.join('/') },
}));

vi.mock('@/lib/tauri/runtime', () => ({
  isMacOSRuntime: () => false,
  isMobileRuntime: () => mobileFlag.value,
  isIOSRuntime: () => false,
}));

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(async () => {}) }),
  };
});

vi.mock('@/lib/storage', () => ({
  useStorage: () => ({ value: {} }),
}));

vi.mock('@/store', () => ({
  useStore: () => ({}),
}));

vi.mock('@/store/note', () => ({
  useNoteStore: () => ({}),
}));

vi.mock('@/store/folder', () => ({
  useFolderStore: () => ({}),
}));

vi.mock('@/composable/useSounds', () => ({
  useSounds: () => ({ play: vi.fn() }),
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
  MOBILE_PLANS: [
    { plan: 'starter', interval: 'monthly' },
    { plan: 'starter', interval: 'yearly' },
    { plan: 'pro', interval: 'monthly' },
    { plan: 'pro', interval: 'yearly' },
  ],
  IAP_PRODUCT_IDS: {
    'starter-monthly': 'com.beavernotes.starter.monthly',
    'starter-yearly': 'com.beavernotes.starter.yearly',
    'pro-monthly': 'com.beavernotes.pro.monthly',
    'pro-yearly': 'com.beavernotes.pro.yearly',
  },
  planFromProductId: () => null,
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

vi.mock('@/assets/images/logo-transparent.png', () => ({ default: 'logo.png' }));

vi.mock('@/utils/sync/vault-key-params.js', () => ({
  fetchCloudKeyParams: vi.fn(async () => null),
  getFetchedCloudKeyParams: vi.fn(() => null),
  deriveVaultPassphraseProof: vi.fn(async () => 'proof'),
}));

vi.mock('@/store/workspace.ts', () => ({
  useWorkspaceStore: () => ({ activeId: 'ws-1', workspaces: [] }),
}));

vi.mock('@/lib/api/client', () => ({
  getApiClient: () => ({
    createVaultChallenge: vi.fn(async () => ({ challenge: 'c' })),
    verifyVaultPassphrase: vi.fn(async () => ({ ok: true })),
  }),
}));

vi.mock('@/lib/account-storage', () => ({
  loadSessionToken: vi.fn(async () => 'token'),
}));

import { useOnboardingFlow } from '../useOnboardingFlow.js';
import Onboarding from '../../pages/Onboarding.vue';

describe('onboarding plans step', () => {
  it('registers plans after account in flow and wizard steps', () => {
    const src = readFileSync('src/composable/useOnboardingFlow.js', 'utf8');
    expect(src).toMatch(/'account',\s*'plans'/);
    expect(src).toMatch(/WIZARD_STEPS = \[[^\]]*'plans'[^\]]*\]/);
  });
  it('Onboarding renders the plans template', () => {
    const vue = readFileSync('src/pages/Onboarding.vue', 'utf8');
    expect(vue).toMatch(/step === 'plans'/);
    expect(vue).toMatch(/SubscriptionPlans/);
  });
  it('gates plans template and watcher to mobile runtime', () => {
    const src = readFileSync('src/composable/useOnboardingFlow.js', 'utf8');
    expect(src).toMatch(/isMobileRuntime \? flow : flow\.filter\(\(s\) => s !== 'plans'\)/);
    const vue = readFileSync('src/pages/Onboarding.vue', 'utf8');
    expect(vue).toMatch(/step === 'plans' && isMobileRuntime/);
    expect(vue).toMatch(/\{ immediate: true \}/);
  });
  it('gates restore success on paid plan', () => {
    const vue = readFileSync('src/pages/Onboarding.vue', 'utf8');
    expect(vue).toMatch(/handlePlansRestore/);
    expect(vue).toMatch(/No purchases found for this account\./);
  });
});

describe('onboarding plans gating (mocked runtime)', () => {
  const makeFlow = () =>
    useOnboardingFlow({
      router: { replace: vi.fn(async () => {}) },
      clipboard: {},
      runImportSource: vi.fn(async () => {}),
    });

  it('includes sync step for guests, hides it when authenticated', () => {
    mobileFlag.value = false;
    iapCtl.authed = false;
    iapCtl.paid = false;
    expect(makeFlow().trackedSteps.value).toEqual([
      'account',
      'password',
      'import',
      'sync',
      'customize',
    ]);
    iapCtl.authed = true;
    expect(makeFlow().trackedSteps.value).toEqual([
      'account',
      'password',
      'import',
      'customize',
    ]);
  });
  it('includes plans in flow on mobile for signed-in free users', () => {
    mobileFlag.value = true;
    iapCtl.authed = true;
    iapCtl.paid = false;
    const flow = makeFlow();
    expect(flow.trackedSteps.value).toContain('plans');
  });
  it('excludes plans on mobile when a paid plan is present', () => {
    mobileFlag.value = true;
    iapCtl.authed = true;
    iapCtl.paid = true;
    const flow = makeFlow();
    expect(flow.trackedSteps.value).not.toContain('plans');
  });
  it('excludes plans on mobile without signup/login', () => {
    mobileFlag.value = true;
    iapCtl.authed = false;
    iapCtl.paid = false;
    const flow = makeFlow();
    expect(flow.trackedSteps.value).not.toContain('plans');
  });
});

describe('onboarding plans handlers (mounted)', () => {
  beforeEach(() => {
    mobileFlag.value = true;
    iapCtl.authed = true;
    iapCtl.paid = true;
    iapCtl.buyImpl = async () => 'pro';
    iapCtl.restoreImpl = async () => {};
  });

  const mountOnboarding = () =>
    mount(Onboarding, {
      global: {
        stubs: {
          'ui-button': { template: '<button><slot /></button>' },
          'ui-input': true,
          'ui-card': true,
          'ui-modal': true,
          'v-remixicon': true,
          SubscriptionPlans: { template: '<div />' },
        },
      },
    });

  it('buy resolving a plan clears the error and releases busy', async () => {
    iapCtl.buyImpl = async () => 'pro';
    const w = mountOnboarding();
    await flushPromises();
    await w.vm.handlePlansSelect('pro', 'monthly');
    expect(w.vm.plansBusy).toBe(false);
  });

  it('buy resolving null shows the processing message', async () => {
    iapCtl.buyImpl = async () => null;
    const w = mountOnboarding();
    await flushPromises();
    await w.vm.handlePlansSelect('pro', 'monthly');
    expect(w.vm.state.error).toMatch(/Payment processing/);
    expect(w.vm.plansBusy).toBe(false);
  });

  it('buy throwing surfaces the error', async () => {
    iapCtl.buyImpl = async () => {
      throw new Error('card declined');
    };
    const w = mountOnboarding();
    await flushPromises();
    await w.vm.handlePlansSelect('pro', 'monthly');
    expect(w.vm.state.error).toBe('card declined');
    expect(w.vm.plansBusy).toBe(false);
  });

  it('restore with nothing owned shows the neutral message', async () => {
    iapCtl.paid = false;
    const w = mountOnboarding();
    await flushPromises();
    await w.vm.handlePlansRestore();
    expect(w.vm.state.error).toMatch(/No purchases found/);
    expect(w.vm.plansBusy).toBe(false);
  });

  it('restore when paid leaves the error clear', async () => {
    iapCtl.paid = true;
    const w = mountOnboarding();
    await flushPromises();
    await w.vm.handlePlansRestore();
    expect(w.vm.state.error).toBe('');
    expect(w.vm.plansBusy).toBe(false);
  });
});
