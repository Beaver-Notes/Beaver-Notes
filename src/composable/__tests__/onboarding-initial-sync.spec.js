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

const markOnboardingCompletedMock = vi.fn(async () => {});
vi.mock('@/utils/onboarding/index.js', () => ({
  applyOnboardingSyncPreferences: vi.fn(async () => {}),
  getOnboardingMigrationStatus: vi.fn(async () => ({ hasLegacyData: false })),
  markOnboardingCompleted: (...a) => markOnboardingCompletedMock(...a),
  probeCustomMigrationPath: vi.fn(async () => ({ hasLegacyData: false })),
  runOnboardingMigration: vi.fn(async () => {}),
  runOnboardingMigrationFromPath: vi.fn(async () => {}),
  ENTRANCE_DELAYS: { logo: 120, text: 580, cta: 1020 },
}));

vi.mock('@/utils/crypto/encryption.js', () => ({
  setupEncryption: vi.fn(async () => ({ ok: true })),
  hasRemoteVaultKeyParams: vi.fn(async () => false),
  adoptVaultKey: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@/utils/onboarding/sync-policy.js', () => ({
  getOnboardingSyncTransport: vi.fn(() => 'remote'),
}));

vi.mock('@/utils/sync/path.js', () => ({
  setSyncPath: vi.fn(async () => {}),
}));

const forceSyncNowMock = vi.fn(async () => {});
vi.mock('@/utils/sync', () => ({
  forceSyncNow: (...a) => forceSyncNowMock(...a),
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

describe('useOnboardingFlow.completeAndOpenWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markOnboardingCompletedMock.mockImplementation(async () => {});
    forceSyncNowMock.mockImplementation(async () => {});
  });

  it('triggers the first sync after marking onboarding complete', async () => {
    const flow = useOnboardingFlow({
      router: { replace: vi.fn(async () => {}) },
      clipboard: {},
      runImportSource: vi.fn(async () => {}),
    });

    await flow.completeAndOpenWorkspace();

    expect(markOnboardingCompletedMock).toHaveBeenCalledTimes(1);
    expect(forceSyncNowMock).toHaveBeenCalledTimes(1);
  });

  it('still navigates home when the sync trigger fails', async () => {
    const replace = vi.fn(async () => {});
    const flow = useOnboardingFlow({
      router: { replace },
      clipboard: {},
      runImportSource: vi.fn(async () => {}),
    });
    forceSyncNowMock.mockImplementation(() => Promise.reject(new Error('sync down')));

    await flow.completeAndOpenWorkspace();

    expect(replace).toHaveBeenCalledWith('/');
    expect(flow.state.error).toBe('');
  });
});
