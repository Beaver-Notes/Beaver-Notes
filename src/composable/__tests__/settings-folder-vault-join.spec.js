import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent, ref } from 'vue';
import { mount } from '@vue/test-utils';

vi.mock('@/utils/crypto/codec.js', () => ({
  hexToBuf: vi.fn(),
  base64ToBuf: vi.fn(),
}));

vi.mock('@/lib/settings', () => ({
  getSettingSync: vi.fn(() => null),
  setSetting: vi.fn(async () => {}),
}));

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
  relaunchApp: vi.fn(async () => {}),
  setSpellcheck: vi.fn(),
}));

vi.mock('@/lib/native/backup', () => ({
  exportBackup: vi.fn(async () => {}),
  importBackup: vi.fn(async () => {}),
}));

vi.mock('@/lib/tauri/errors', () => ({
  errorMessage: (e) => e?.message || String(e),
}));

vi.mock('@/lib/tauri-bridge', () => ({
  path: { join: (...p) => p.join('/') },
  backend: { invoke: vi.fn(async () => {}) },
}));

vi.mock('@/lib/native/fs', () => ({
  copyPath: vi.fn(async () => {}),
  readJson: vi.fn(async () => ({})),
  removePath: vi.fn(async () => {}),
}));

vi.mock('@/store/app', () => ({
  useAppStore: () => ({
    setting: {},
    setSettingStorage: vi.fn(),
  }),
}));

vi.mock('@/store/i18n', () => ({
  useI18nStore: () => ({ setLanguage: vi.fn(async () => {}) }),
}));

vi.mock('@/utils/ui/globalShortcuts.js', () => ({
  bindGlobalShortcuts: vi.fn(() => () => {}),
}));

vi.mock('@/lib/native/security.js', () => ({
  clearAssetPassphrase: vi.fn(async () => {}),
  clearSecureBlob: vi.fn(async () => {}),
}));

const hasRemoteVaultKeyParamsMock = vi.fn(async () => false);
const adoptVaultKeyMock = vi.fn(async () => ({ ok: true }));
vi.mock('@/utils/crypto/encryption.js', () => ({
  ensureKeyReadyForWrite: vi.fn(async () => true),
  verifyPassphrase: vi.fn(async () => ({ ok: true })),
  hasRemoteVaultKeyParams: (...a) => hasRemoteVaultKeyParamsMock(...a),
  adoptVaultKey: (...a) => adoptVaultKeyMock(...a),
  setDeclinedVaultJoin: vi.fn(async () => {}),
}));

vi.mock('@/utils/i18n/languages.js', () => ({
  ONBOARDING_LANGUAGE_CONFIG: { en: { name: 'English' } },
  getLanguageDirection: () => 'ltr',
}));

const forceSyncNowMock = vi.fn(async () => {});
const startPullTimerMock = vi.fn(() => {});
vi.mock('@/utils/sync', () => ({
  forceSyncNow: (...a) => forceSyncNowMock(...a),
  startPullTimer: (...a) => startPullTimerMock(...a),
}));

const startRustSyncMock = vi.fn(async () => {});
vi.mock('@/utils/sync/rust-shim.js', () => ({
  startRustSync: (...a) => startRustSyncMock(...a),
}));

import { useSettingsData } from '../useSettingsData.js';

describe('useSettingsData.chooseDefaultPath with an existing folder vault', () => {
  let dialog;
  let exposed;

  beforeEach(() => {
    vi.clearAllMocks();
    hasRemoteVaultKeyParamsMock.mockResolvedValue(false);
    adoptVaultKeyMock.mockResolvedValue({ ok: true });
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
    expect(startPullTimerMock).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(dialog.prompt).toHaveBeenCalledTimes(1));
    expect(dialog.prompt.mock.calls[0][0].password).toBe(true);

    await dialog.prompt.mock.calls[0][0].onConfirm('vault-password');

    expect(adoptVaultKeyMock).toHaveBeenCalledWith('vault-password');
    expect(forceSyncNowMock).toHaveBeenCalled();
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
    expect(forceSyncNowMock).not.toHaveBeenCalled();
  });

  it('syncs straight away when the folder holds no vault', async () => {
    openDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/fresh'] });

    await exposed.chooseDefaultPath();

    expect(setSyncPathMock).toHaveBeenCalledWith('/fresh');
    expect(dialog.prompt).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(forceSyncNowMock).toHaveBeenCalledTimes(1)
    );
  });
});
