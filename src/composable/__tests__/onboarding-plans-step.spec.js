import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { ref } from 'vue';

const mobileFlag = vi.hoisted(() => ({ value: false }));
const accountCtl = vi.hoisted(() => ({ authed: false, paid: false }));
const syncPrefs = vi.hoisted(() => ({ calls: [] }));
const setSettingCtl = vi.hoisted(() => ({ sets: [] }));
const vaultJoinCtl = vi.hoisted(() => ({ detect: null }));

vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({ translations: ref({}) }),
}));

vi.mock('@/composable/theme', () => ({
  useTheme: () => ({ loadTheme: vi.fn(), isDark: () => false }),
}));

vi.mock('@/lib/settings', () => ({
  DEFAULT_UI_FONT_STACK: "'Inter'",
  getSetting: vi.fn(async () => null),
  getSettingSync: vi.fn(() => null),
  invalidateSettingMirrors: vi.fn(),
  setSetting: vi.fn(async (key, value) => {
    setSettingCtl.sets.push([key, value]);
  }),
}));

vi.mock('@/store/account', () => ({
  useAccountStore: () => ({
    get isAuthenticated() {
      return accountCtl.authed;
    },
    get isPaidPlan() {
      return accountCtl.paid;
    },
    serverUrl: 'https://api.test',
    status: 'anonymous',
    subscription: null,
    profile: null,
  }),
}));

vi.mock('@/lib/dialog', () => ({
  useDialog: () => ({ confirm: vi.fn() }),
}));

vi.mock('@/utils/onboarding/index.js', () => ({
  applyOnboardingSyncPreferences: vi.fn(async (prefs) => {
    syncPrefs.calls.push({ ...prefs });
  }),
  getOnboardingMigrationStatus: vi.fn(async () => ({ hasLegacyData: false })),
  markOnboardingCompleted: vi.fn(async () => {}),
  probeCustomMigrationPath: vi.fn(async () => ({ hasLegacyData: false })),
  runOnboardingMigration: vi.fn(async () => {}),
  runOnboardingMigrationFromPath: vi.fn(async () => {}),
  ENTRANCE_DELAYS: { logo: 120, text: 580, cta: 1020 },
  CURTAIN_DURATIONS: { in: 420, out: 320, hold: 0, open: 0 },
}));

vi.mock('@/utils/onboarding/import-finalize.js', () => ({
  buildImportedSearchIndex: vi.fn(async () => {}),
  secureImportedAssets: vi.fn(async () => {}),
}));

vi.mock('@/utils/crypto/encryption.js', () => ({
  setupEncryption: vi.fn(async () => ({ ok: true })),
  hasRemoteVaultKeyParams: vi.fn(async () => false),
  adoptVaultKey: vi.fn(async () => ({ ok: true })),
  isKeyLoaded: vi.fn(() => false),
  publishLocalKeyParamsToFolder: vi.fn(async () => {}),
  setDeclinedVaultJoin: vi.fn(async () => {}),
}));

vi.mock('@/utils/onboarding/sync-policy.js', () => ({
  getOnboardingSyncTransport: vi.fn(({ isAuthenticated, isPaidPlan }) =>
    isAuthenticated && isPaidPlan ? 'remote' : 'folder',
  ),
  getOnboardingSyncLocation: vi.fn(({ isAuthenticated, isPaidPlan }) =>
    isAuthenticated && isPaidPlan ? 'cloud' : 'local',
  ),
}));

vi.mock('@/utils/sync/path.js', () => ({
  setSyncPath: vi.fn(async () => {}),
}));

vi.mock('@/utils/sync/rust-shim.js', () => ({
  kickRustSync: vi.fn(() => true),
  startRustSync: vi.fn(async () => {}),
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
  isPlatformVisible: vi.fn(() => false),
}));

vi.mock('@/lib/tauri/runtime', () => ({
  isMacOSRuntime: () => false,
  isMobileRuntime: () => mobileFlag.value,
  isIOSRuntime: () => false,
}));

vi.mock('@/lib/native/dialog', () => ({
  openDialog: vi.fn(async () => ({ canceled: true })),
}));

vi.mock('@/lib/native/app', () => ({
  readLegacyData: vi.fn(async () => null),
}));

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

vi.mock('@/utils/sync/vault-key-params.js', () => ({
  fetchCloudKeyParams: vi.fn(async () => null),
  getFetchedCloudKeyParams: vi.fn(() => null),
  deriveVaultPassphraseProof: vi.fn(async () => 'proof'),
}));

vi.mock('@/utils/onboarding/remote-vault-join.js', () => ({
  detectRemoteVaultJoin: (...a) => vaultJoinCtl.detect(...a),
  completeRemoteVaultJoin: vi.fn(async () => ({ ok: true })),
  adoptWorkspaceKeysFromVault: vi.fn(async () => {}),
}));

vi.mock('@/store/workspace.ts', () => ({
  useWorkspaceStore: () => ({ activeId: 'ws-1', workspaces: [], retrieve: vi.fn() }),
}));

vi.mock('@/composable/useCloudWorkspaces', () => ({
  useCloudWorkspaces: () => ({ workspaces: ref([]) }),
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

vi.mock('@/lib/yjs/meta-store.js', () => ({
  writeStoresFromWorkspace: vi.fn(async () => {}),
  seedWorkspaceDocFromData: vi.fn(async () => ({ seededFolders: 0 })),
}));

import { useOnboardingFlow } from '../useOnboardingFlow.js';

const makeFlow = () =>
  useOnboardingFlow({
    router: { replace: vi.fn(async () => {}) },
    clipboard: {},
    runImportSource: vi.fn(async () => {}),
  });

describe('onboarding wizard structure', () => {
  it('registers Connect as the first card step, with no plans or customize step', () => {
    const src = readFileSync('src/composable/useOnboardingFlow.js', 'utf8');
    expect(src).toMatch(/WIZARD_STEPS = \['account', 'password', 'import'\]/);
    expect(src).not.toMatch(/'plans'/);
    expect(src).not.toMatch(/completeSyncStep|useOnboardingAppearance/);
  });

  it('Onboarding renders no plans or customization templates', () => {
    const vue = readFileSync('src/pages/Onboarding.vue', 'utf8');
    expect(vue).not.toMatch(/step === 'plans'/);
    expect(vue).not.toMatch(/step === 'customize'/);
    expect(vue).not.toMatch(/SubscriptionPlans/);
    expect(vue).not.toMatch(/useIapBilling/);
  });

  it('Connect footer offers both Continue and Skip', () => {
    const vue = readFileSync('src/pages/Onboarding.vue', 'utf8');
    expect(vue).toMatch(/onboarding-connect-continue/);
    expect(vue).toMatch(/onboarding-connect-skip/);
    expect(vue).toMatch(/flow\.completeAccountStep/);
  });

  it('exposes a folder-sync picker inside the Connect card', () => {
    const vue = readFileSync('src/pages/Onboarding.vue', 'utf8');
    expect(vue).toMatch(/showFolderSync/);
    expect(vue).toMatch(/onboarding-sync-path/);
  });
});

describe('onboarding tracked steps', () => {
  it('is account → password → import regardless of account state', () => {
    mobileFlag.value = false;
    accountCtl.authed = false;
    accountCtl.paid = false;
    expect(makeFlow().trackedSteps.value).toEqual([
      'account',
      'password',
      'import',
    ]);

    accountCtl.authed = true;
    accountCtl.paid = true;
    expect(makeFlow().trackedSteps.value).toEqual([
      'account',
      'password',
      'import',
    ]);
  });
});

describe('completeAccountStep', () => {
  beforeEach(() => {
    setSettingCtl.sets = [];
    syncPrefs.calls = [];
    vaultJoinCtl.detect = vi.fn(async () => false);
    accountCtl.authed = false;
    accountCtl.paid = false;
  });

  it('commits sync preferences and advances to password for guests', async () => {
    const flow = makeFlow();
    flow.goToStep('account');
    flow.fresh.syncPath = '/tmp/sync';
    await flow.completeAccountStep();

    expect(syncPrefs.calls[0]).toMatchObject({ syncPath: '/tmp/sync' });
    expect(setSettingCtl.sets).not.toContainEqual([
      'syncTransport',
      expect.anything(),
    ]);
    expect(flow.step.value).toBe('password');
  });

  it('detects an existing folder vault for guests and lands in join mode', async () => {
    const { hasRemoteVaultKeyParams } = await import(
      '@/utils/crypto/encryption.js'
    );
    hasRemoteVaultKeyParams.mockResolvedValue(true);
    const flow = makeFlow();
    flow.goToStep('account');
    flow.fresh.syncPath = '/existing-vault';
    await flow.completeAccountStep();

    expect(flow.vaultJoinMode.value).toBe(true);
    expect(flow.step.value).toBe('password');
  });

  it('sets remote transport for paid signed-in users', async () => {
    accountCtl.authed = true;
    accountCtl.paid = true;
    const flow = makeFlow();
    flow.goToStep('account');
    await flow.completeAccountStep();

    expect(setSettingCtl.sets).toContainEqual(['syncTransport', 'remote']);
    expect(flow.step.value).toBe('password');
  });

  it('is skippable without committing preferences', async () => {
    const flow = makeFlow();
    flow.step.value = 'account';
    flow.goToNextStep();

    expect(flow.step.value).toBe('password');
    expect(syncPrefs.calls).toHaveLength(0);
  });
});
