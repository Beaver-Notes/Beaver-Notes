import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

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

// Local (unauthenticated) user: folder sync step is in the flow.
vi.mock('@/store/account', () => ({
  useAccountStore: () => ({
    isAuthenticated: false,
    isPaidPlan: false,
    canUseCloudSync: false,
    serverUrl: 'https://api.test',
    status: 'guest',
    subscription: null,
    profile: null,
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

const hasRemoteVaultKeyParamsMock = vi.fn(async () => false);
vi.mock('@/utils/crypto/encryption.js', () => ({
  setupEncryption: vi.fn(async () => ({ ok: true })),
  hasRemoteVaultKeyParams: (...a) => hasRemoteVaultKeyParamsMock(...a),
  adoptVaultKey: vi.fn(async () => ({ ok: true })),
  isKeyLoaded: () => false,
  publishLocalKeyParamsToFolder: vi.fn(async () => ({})),
  setDeclinedVaultJoin: vi.fn(async () => {}),
}));

vi.mock('@/composable/useAccountAuth', () => ({
  useAccountAuth: () => ({ triggerSeed: vi.fn(() => Promise.resolve()) }),
}));

vi.mock('@/utils/onboarding/sync-policy.js', () => ({
  getOnboardingSyncTransport: vi.fn(() => 'local'),
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
    isMobileRuntime: () => false,
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
  useWorkspaceStore: () => ({ activeId: null, workspaces: [] }),
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

describe('useOnboardingFlow.completeSyncStep with an existing folder vault', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasRemoteVaultKeyParamsMock.mockResolvedValue(false);
  });

  const makeFlow = () =>
    useOnboardingFlow({
      router: { replace: vi.fn(async () => {}) },
      clipboard: {},
      runImportSource: vi.fn(async () => {}),
    });

  it('lands on the password step in join mode instead of finishing with a fresh key', async () => {
    const flow = makeFlow();
    flow.goToStep('sync');
    flow.fresh.syncPath = '/existing-vault';
    // The picked folder holds another device's vault.
    hasRemoteVaultKeyParamsMock.mockResolvedValue(true);

    await flow.completeSyncStep();

    expect(flow.vaultJoinMode.value).toBe(true);
    expect(flow.step.value).toBe('password');
  });

  it('moves to the passphrase step when the picked folder holds no vault', async () => {
    const flow = makeFlow();
    flow.goToStep('sync');
    flow.fresh.syncPath = '/fresh-folder';

    await flow.completeSyncStep();

    expect(flow.vaultJoinMode.value).toBe(false);
    expect(flow.step.value).toBe('password');
  });

  it('respects an explicit start-fresh choice and stays in create mode', async () => {
    const flow = makeFlow();
    flow.goToStep('sync');
    flow.fresh.syncPath = '/existing-vault';
    hasRemoteVaultKeyParamsMock.mockResolvedValue(true);

    await flow.completeSyncStep();
    expect(flow.step.value).toBe('password');

    // User explicitly declines the join, moves forward, picks the folder again.
    flow.startFreshVault();
    flow.goToStep('sync');
    await flow.completeSyncStep();

    expect(flow.vaultJoinMode.value).toBe(false);
    expect(flow.step.value).toBe('password');
  });

  it('persists the decline marker on start-fresh so the engine pauses', async () => {
    const { setDeclinedVaultJoin } = await import(
      '@/utils/crypto/encryption.js'
    );
    const flow = makeFlow();
    flow.fresh.syncPath = '/existing-vault';

    flow.startFreshVault();

    expect(setDeclinedVaultJoin).toHaveBeenCalledWith('/existing-vault');
  });

  it('publishes fresh params and clears the marker after the passphrase is set (start-fresh)', async () => {
    const { publishLocalKeyParamsToFolder, setDeclinedVaultJoin } =
      await import('@/utils/crypto/encryption.js');
    const flow = makeFlow();
    flow.goToStep('sync');
    flow.fresh.syncPath = '/existing-vault';
    hasRemoteVaultKeyParamsMock.mockResolvedValue(true);

    await flow.completeSyncStep();
    flow.startFreshVault();
    flow.goToStep('sync');
    await flow.completeSyncStep();

    flow.encryptionPassword.value = 'password123';
    flow.encryptionConfirmPassword.value = 'password123';
    await flow.setupEncryptionPassword();

    expect(publishLocalKeyParamsToFolder).toHaveBeenCalledTimes(1);
    expect(setDeclinedVaultJoin).toHaveBeenLastCalledWith('');
    expect(flow.step.value).toBe('import');
  });

  it('clears the decline marker when a new folder is picked', async () => {
    const { setDeclinedVaultJoin } = await import(
      '@/utils/crypto/encryption.js'
    );
    const { openDialog } = await import('@/lib/native/dialog');
    openDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/other-folder'],
    });
    const flow = makeFlow();

    await flow.chooseSyncPath();

    expect(flow.fresh.syncPath).toBe('/other-folder');
    expect(setDeclinedVaultJoin).toHaveBeenCalledWith('');
  });
});
