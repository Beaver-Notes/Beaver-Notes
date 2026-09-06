import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ref } from 'vue';

const mobileFlag = vi.hoisted(() => ({ value: false }));

vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({ translations: ref({}) }),
}));

vi.mock('@/composable/useTheme', () => ({
  useTheme: () => ({ loadTheme: vi.fn() }),
}));

vi.mock('@/composable/useOnboardingAppearance', () => ({
  useOnboardingAppearance: () => ({
    selectAccentColor: vi.fn(),
    selectZoomLevel: vi.fn(),
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
    isAuthenticated: true,
    isPaidPlan: true,
    canUseCloudSync: true,
    serverUrl: 'https://api.test',
    status: 'authenticated',
    subscription: { plan: 'team' },
    profile: { id: 'u1' },
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
  CURTAIN_DURATIONS: { in: 420, out: 320 },
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

vi.mock('@/utils/sync', () => ({
  forceSyncNow: vi.fn(async () => {}),
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
  addCloseHandler: vi.fn(),
  path: { join: (...p) => p.join('/') },
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
});

describe('onboarding plans gating (mocked runtime)', () => {
  const makeFlow = () =>
    useOnboardingFlow({
      router: { replace: vi.fn(async () => {}) },
      clipboard: {},
      runImportSource: vi.fn(async () => {}),
    });

  it('excludes plans from flow on desktop', () => {
    mobileFlag.value = false;
    const flow = makeFlow();
    expect(flow.trackedSteps.value).not.toContain('plans');
    expect(flow.trackedSteps.value).toEqual(['account', 'password', 'import', 'customize']);
  });
  it('includes plans in flow on mobile', () => {
    mobileFlag.value = true;
    const flow = makeFlow();
    expect(flow.trackedSteps.value).toContain('plans');
  });
});
