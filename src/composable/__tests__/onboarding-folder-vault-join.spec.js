import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent, ref } from 'vue';
import { mount } from '@vue/test-utils';

// One shared preamble for every entry point that joins an existing folder
// vault: useOnboardingFlow reads, useSettingsData reads, and the account
// revoke-confirm smoke. Same behavior, different hosts.
vi.mock('@/lib/settings', () => ({
  DEFAULT_SERVER_URL: 'https://api.test',
  DEFAULT_UI_FONT_STACK: "'Inter'",
  getSetting: vi.fn(async () => null),
  getSettingSync: vi.fn(() => null),
  invalidateSettingMirrors: vi.fn(),
  setSetting: vi.fn(async () => {}),
  settingsMirrorKey: vi.fn((key) => key),
}));

// Local (unauthenticated) user: folder sync step is in the flow.
vi.mock('@/store/account', () => ({
  useAccountStore: () => ({
    isAuthenticated: false,
    isPaidPlan: false,
    canUseCloudSync: false,
    plan: 'free',
    serverUrl: 'https://api.test',
    status: 'guest',
    subscription: null,
    profile: null,
    setProfile: vi.fn(),
    setSubscription: vi.fn(),
    setDevices: vi.fn(),
    setSeedStatus: vi.fn(),
    setSeedProgress: vi.fn(),
    setError: vi.fn(),
  }),
}));

vi.mock('@/composable/theme', () => ({
  useTheme: () => ({ loadTheme: vi.fn() }),
}));

const authCtl = vi.hoisted(() => ({
  triggerSeed: vi.fn(() => Promise.resolve()),
  revokeDevice: vi.fn(async () => {}),
  revokeActiveSession: vi.fn(async () => {}),
  listSessions: vi.fn(async () => []),
}));
vi.mock('@/composable/useAccountAuth', () => ({
  useAccountAuth: () => ({
    triggerSeed: authCtl.triggerSeed,
    revokeDevice: authCtl.revokeDevice,
    revokeActiveSession: authCtl.revokeActiveSession,
    listActiveSessions: authCtl.listSessions,
    refreshProfile: vi.fn(async () => {}),
    signOut: vi.fn(),
    signOutEverywhere: vi.fn(),
    deleteAccount: vi.fn(),
  }),
}));

vi.mock('@/lib/api/account', () => ({
  updateUsername: vi.fn(async () => {}),
  getAccountExport: vi.fn(async () => ({})),
}));

vi.mock('@/utils/notes/local-note-count.js', () => ({ localNoteCount: () => 0 }));

const setSyncPathMock = vi.fn(async (dir) => dir);
vi.mock('@/utils/sync/path.js', () => ({
  setSyncPath: (...a) => setSyncPathMock(...a),
  getSyncPath: vi.fn(async () => ''),
}));

const openDialogMock = vi.fn(async () => ({ canceled: true }));
vi.mock('@/lib/native/dialog', () => ({
  openDialog: (...a) => openDialogMock(...a),
  showMessage: vi.fn(),
}));

vi.mock('@/lib/native/app', () => ({
  getAppDirectory: vi.fn(async () => '/app'),
  getHelperPath: vi.fn(async () => '/tmp'),
  getNativeDarkTheme: vi.fn(async () => 'light'),
  relaunchApp: vi.fn(async () => {}),
  setSpellcheck: vi.fn(),
  readLegacyData: vi.fn(async () => null),
}));

vi.mock('@/lib/native/backup', () => ({
  exportBackup: vi.fn(async () => {}),
  importBackup: vi.fn(async () => {}),
}));

vi.mock('@/lib/tauri/errors', () => ({
  errorMessage: (e) => e?.message || String(e),
  isError: () => false,
}));

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

vi.mock('@/lib/native/fs', () => ({
  copyPath: vi.fn(async () => {}),
  readJson: vi.fn(async () => ({})),
  removePath: vi.fn(async () => {}),
}));

vi.mock('@/lib/native/security.js', () => ({
  clearAssetPassphrase: vi.fn(async () => {}),
  clearSecureBlob: vi.fn(async () => {}),
  isEncryptionAvailable: vi.fn(async () => false),
  encryptString: vi.fn(async (s) => s),
  decryptString: vi.fn(async (s) => s),
  storeSecureBlob: vi.fn(async () => {}),
  fetchSecureBlob: vi.fn(async () => null),
  syncKeyReady: vi.fn(async () => true),
  syncEncryptPayload: vi.fn(async (p) => p),
  syncDecryptPayload: vi.fn(async (p) => p),
}));

vi.mock('@/utils/crypto/codec.js', () => ({
  hexToBuf: vi.fn(),
  base64ToBuf: vi.fn(),
  bufToHex: vi.fn(),
  bufToBase64: vi.fn(),
}));

vi.mock('@/store/app', () => ({
  useAppStore: () => ({ setting: {}, setSettingStorage: vi.fn() }),
}));

vi.mock('@/store/i18n', () => ({
  useI18nStore: () => ({
    messages: { onboarding: {}, settings: {}, dialog: {} },
    setLanguage: vi.fn(async () => {}),
  }),
}));

vi.mock('@/utils/ui/globalShortcuts.js', () => ({
  bindGlobalShortcuts: vi.fn(() => () => {}),
}));

vi.mock('@/utils/i18n/languages.js', () => ({
  ONBOARDING_LANGUAGE_CONFIG: { en: { name: 'English' } },
  getLanguageDirection: () => 'ltr',
}));

const kickRustSyncMock = vi.fn(() => true);
const startRustSyncMock = vi.fn(async () => {});
vi.mock('@/utils/sync/rust-shim.js', () => ({
  kickRustSync: (...a) => kickRustSyncMock(...a),
  startRustSync: (...a) => startRustSyncMock(...a),
  kickRustDirty: vi.fn(),
}));

const hasRemoteVaultKeyParamsMock = vi.fn(async () => false);
const encryptionIsConfiguredMock = vi.fn(async () => false);
const verifyPassphraseMock = vi.fn(async () => ({ ok: true }));
const adoptVaultKeyMock = vi.fn(async () => ({ ok: true }));
vi.mock('@/utils/crypto/encryption.js', () => ({
  setupEncryption: vi.fn(async () => ({ ok: true })),
  encryptionIsConfigured: (...a) => encryptionIsConfiguredMock(...a),
  verifyPassphrase: (...a) => verifyPassphraseMock(...a),
  hasRemoteVaultKeyParams: (...a) => hasRemoteVaultKeyParamsMock(...a),
  adoptVaultKey: (...a) => adoptVaultKeyMock(...a),
  ensureKeyReadyForWrite: vi.fn(async () => true),
  reconcileFolderVault: vi.fn(async () => true),
  isEncryptionEnabled: vi.fn(async () => false),
  isKeyLoaded: () => false,
  publishLocalKeyParamsToFolder: vi.fn(async () => ({})),
  setDeclinedVaultJoin: vi.fn(async () => {}),
}));

vi.mock('@/lib/api/client', () => ({
  getApiClient: () => ({
    createVaultChallenge: vi.fn(async () => ({ challenge: 'c' })),
    verifyVaultPassphrase: vi.fn(async () => ({ ok: true })),
  }),
  ApiError: class ApiError extends Error {},
}));

vi.mock('@/lib/account-storage', () => ({
  loadSessionToken: vi.fn(async () => 'token'),
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

vi.mock('@/utils/onboarding/sync-policy.js', () => ({
  getOnboardingSyncTransport: vi.fn(() => 'local'),
}));

vi.mock('@/utils/onboarding/import-finalize.js', () => ({
  buildImportedSearchIndex: vi.fn(async () => {}),
  secureImportedAssets: vi.fn(async () => {}),
}));

vi.mock('@/utils/onboarding/remote-vault-join.js', () => ({
  detectRemoteVaultJoin: vi.fn(async () => false),
  completeRemoteVaultJoin: vi.fn(async () => ({ ok: true })),
  adoptWorkspaceKeysFromVault: vi.fn(async () => {}),
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

vi.mock('@/assets/images/logo-transparent.png', () => ({ default: 'logo.png' }));

vi.mock('@/utils/sync/vault-key-params.js', () => ({
  fetchCloudKeyParams: vi.fn(async () => null),
  getFetchedCloudKeyParams: vi.fn(() => null),
  deriveVaultPassphraseProof: vi.fn(async () => 'proof'),
}));

vi.mock('@/store/workspace.ts', () => ({
  useWorkspaceStore: () => ({ activeId: null, workspaces: [], retrieve: vi.fn() }),
}));

import { useOnboardingFlow } from '../useOnboardingFlow.js';
import { useSettingsData } from '../useSettingsData.js';
import { useSettingsAccount } from '../useSettingsAccount.js';

const makeFlow = () =>
  useOnboardingFlow({
    router: { replace: vi.fn(async () => {}) },
    clipboard: {},
    runImportSource: vi.fn(async () => {}),
  });

beforeEach(() => {
  vi.clearAllMocks();
  hasRemoteVaultKeyParamsMock.mockResolvedValue(false);
  encryptionIsConfiguredMock.mockResolvedValue(false);
  verifyPassphraseMock.mockResolvedValue({ ok: true });
  adoptVaultKeyMock.mockResolvedValue({ ok: true });
  openDialogMock.mockReset().mockResolvedValue({ canceled: true });
  kickRustSyncMock.mockReturnValue(true);
  startRustSyncMock.mockResolvedValue(undefined);
  authCtl.triggerSeed.mockReset();
  authCtl.revokeDevice.mockReset();
  authCtl.revokeActiveSession.mockReset();
  authCtl.listSessions.mockReset();
});

describe('useOnboardingFlow.completeAccountStep with an existing folder vault', () => {
  it('lands on the password step in join mode instead of finishing with a fresh key', async () => {
    const flow = makeFlow();
    flow.goToStep('account');
    flow.fresh.syncPath = '/existing-vault';
    // The picked folder holds another device's vault.
    hasRemoteVaultKeyParamsMock.mockResolvedValue(true);

    await flow.completeAccountStep();

    expect(flow.vaultJoinMode.value).toBe(true);
    expect(flow.step.value).toBe('password');
  });

  it('moves to the passphrase step when the picked folder holds no vault', async () => {
    const flow = makeFlow();
    flow.goToStep('account');
    flow.fresh.syncPath = '/fresh-folder';

    await flow.completeAccountStep();

    expect(flow.vaultJoinMode.value).toBe(false);
    expect(flow.step.value).toBe('password');
  });

  it('publishes fresh params and clears the marker after the passphrase is set', async () => {
    const { publishLocalKeyParamsToFolder, setDeclinedVaultJoin } =
      await import('@/utils/crypto/encryption.js');
    const flow = makeFlow();
    flow.goToStep('account');
    flow.fresh.syncPath = '/existing-vault';
    hasRemoteVaultKeyParamsMock.mockResolvedValue(true);

    await flow.completeAccountStep();

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
    openDialogMock.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/other-folder'],
    });
    const flow = makeFlow();

    await flow.chooseSyncPath();

    expect(flow.fresh.syncPath).toBe('/other-folder');
    expect(setDeclinedVaultJoin).toHaveBeenCalledWith('');
  });
});

describe('useOnboardingFlow password step with a vault already on this device', () => {
  beforeEach(() => {
    encryptionIsConfiguredMock.mockResolvedValue(true);
    verifyPassphraseMock.mockResolvedValue({ ok: true });
  });

  it('unlocks with the existing key instead of minting a new one', async () => {
    const { setupEncryption } = await import('@/utils/crypto/encryption.js');
    const flow = makeFlow();
    flow.goToStep('password');
    flow.encryptionPassword.value = 'existing-key';
    flow.encryptionConfirmPassword.value = 'typed-something-else';

    await flow.setupEncryptionPassword();

    expect(verifyPassphraseMock).toHaveBeenCalledWith('existing-key');
    expect(setupEncryption).not.toHaveBeenCalled();
    expect(flow.step.value).toBe('import');
  });

  it('stays on the password step when the key does not unlock the vault', async () => {
    const { setupEncryption } = await import('@/utils/crypto/encryption.js');
    verifyPassphraseMock.mockResolvedValue({
      ok: false,
      error: 'Wrong password.',
    });
    const flow = makeFlow();
    flow.goToStep('password');
    flow.encryptionPassword.value = 'not-the-key';

    await flow.setupEncryptionPassword();

    expect(setupEncryption).not.toHaveBeenCalled();
    expect(flow.encryptionPasswordError.value).toBe('Wrong password.');
    expect(flow.step.value).toBe('password');
  });
});

describe('useSettingsData.chooseDefaultPath with an existing folder vault', () => {
  let dialog;
  let exposed;

  beforeEach(() => {
    dialog = { alert: vi.fn(), confirm: vi.fn(), prompt: vi.fn() };
    const translations = ref({ settings: {}, dialog: {} });
    const Host = defineComponent({
      setup() {
        exposed = useSettingsData({
          dialog,
          folderStore: {},
          noteStore: {},
          translations,
        });
        return () => null;
      },
    });
    mount(Host);
  });

  it('prompts for the vault password and adopts before syncing', async () => {
    openDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/vault'] });
    hasRemoteVaultKeyParamsMock.mockResolvedValue(true);

    await exposed.chooseDefaultPath();

    expect(setSyncPathMock).toHaveBeenCalledWith('/vault');
    expect(startRustSyncMock).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(dialog.prompt).toHaveBeenCalledTimes(1));
    expect(dialog.prompt.mock.calls[0][0].password).toBe(true);

    await dialog.prompt.mock.calls[0][0].onConfirm('vault-password');

    expect(adoptVaultKeyMock).toHaveBeenCalledWith('vault-password');
    expect(kickRustSyncMock).toHaveBeenCalled();
  });

  it('marks the path declined while prompting so cancel pauses the engine', async () => {
    const { setDeclinedVaultJoin } = await import(
      '@/utils/crypto/encryption.js'
    );
    openDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/vault'] });
    hasRemoteVaultKeyParamsMock.mockResolvedValue(true);

    await exposed.chooseDefaultPath();

    await vi.waitFor(() =>
      expect(setDeclinedVaultJoin).toHaveBeenCalledWith('/vault')
    );

    expect(adoptVaultKeyMock).not.toHaveBeenCalled();
    expect(kickRustSyncMock).not.toHaveBeenCalled();
  });

  it('syncs straight away when the folder holds no vault', async () => {
    openDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/fresh'] });

    await exposed.chooseDefaultPath();

    expect(setSyncPathMock).toHaveBeenCalledWith('/fresh');
    expect(dialog.prompt).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(kickRustSyncMock).toHaveBeenCalledTimes(1)
    );
  });
});

describe('useSettingsAccount revoke confirmations', () => {
  it('gates a device revoke behind the confirm dialog', async () => {
    const confirmCalls = [];
    const dialog = {
      confirm: (opts) => confirmCalls.push(opts),
      alert: vi.fn(),
      prompt: vi.fn(),
    };
    const account = useSettingsAccount({
      dialog,
      translations: ref({ account: {}, dialog: { cancel: 'Cancel' } }),
    });

    account.handleRevokeDevice({ deviceId: 'dev-1', label: 'Work MacBook' });

    expect(confirmCalls).toHaveLength(1);
    expect(confirmCalls[0].title).toContain('Work MacBook');
    expect(authCtl.revokeDevice).not.toHaveBeenCalled();

    await confirmCalls[0].onConfirm();
    expect(authCtl.revokeDevice).toHaveBeenCalledWith('dev-1');
  });
});
