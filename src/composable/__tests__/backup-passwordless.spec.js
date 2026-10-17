import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { bufToBase64, bufToHex } from '@/utils/crypto/codec.js';

vi.mock('@/lib/settings', () => ({
  getSettingSync: vi.fn(() => null),
  setSetting: vi.fn(async () => {}),
  DEFAULT_UI_FONT_STACK: 'ui-sans',
}));

vi.mock('@/utils/sync/path.js', () => ({
  setSyncPath: vi.fn(async (dir) => dir),
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

const listWorkspacesMock = vi.fn(async () => []);
const activeWorkspaceMock = vi.fn(async () => ({ id: 'default' }));
vi.mock('@/lib/native/workspaces', () => ({
  listLocalWorkspaces: (...a) => listWorkspacesMock(...a),
  getActiveLocalWorkspace: (...a) => activeWorkspaceMock(...a),
}));

vi.mock('@/lib/tauri/errors', () => ({
  errorMessage: (e) => e?.message || String(e),
  isError: (e, kind) => e?.kind === kind,
}));

vi.mock('@/lib/tauri-bridge', () => ({
  path: { join: (...p) => p.join('/') },
  backend: { invoke: vi.fn(async () => {}) },
}));

const readJsonMock = vi.fn(async () => {
  throw new Error('no data.json');
});
vi.mock('@/lib/native/fs', () => ({
  copyPath: vi.fn(async () => {}),
  readJson: (...a) => readJsonMock(...a),
  removePath: vi.fn(async () => {}),
}));

vi.mock('@/store/app', () => ({
  useAppStore: () => ({ setting: {}, setSettingStorage: vi.fn() }),
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

vi.mock('@/utils/crypto/encryption.js', () => ({
  ensureKeyReadyForWrite: vi.fn(async () => true),
  verifyPassphrase: vi.fn(async () => ({ ok: true })),
  hasRemoteVaultKeyParams: vi.fn(async () => false),
  adoptVaultKey: vi.fn(async () => ({ ok: true })),
  reconcileFolderVault: vi.fn(async () => true),
  setDeclinedVaultJoin: vi.fn(async () => {}),
}));

vi.mock('@/utils/i18n/languages.js', () => ({
  ONBOARDING_LANGUAGE_CONFIG: { en: { name: 'English' } },
  getLanguageDirection: () => 'ltr',
}));

vi.mock('@/utils/notes/local-note-count.js', () => ({
  localNoteCount: () => 0,
}));

vi.mock('@/utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { useSettingsData } from '../useSettingsData.js';

// Mirrors decryptSettings() in useSettingsData.js so a legacy password-protected
// backup can be produced in-process.
async function makeLegacyEncryptedBackup(obj, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    new TextEncoder().encode(JSON.stringify(obj)),
  );
  return JSON.stringify({
    v: 1,
    salt: bufToHex(salt),
    iv: bufToHex(iv),
    cipher: bufToBase64(cipher),
  });
}

describe('backup export/import needs no backup password', () => {
  let dialog;
  let exposed;

  beforeEach(() => {
    vi.clearAllMocks();
    readJsonMock.mockRejectedValue(new Error('no data.json'));
    openDialogMock.mockResolvedValue({ canceled: true });
    listWorkspacesMock.mockResolvedValue([]);
    activeWorkspaceMock.mockResolvedValue({ id: 'default' });
    dialog = { alert: vi.fn(), confirm: vi.fn(), prompt: vi.fn(), select: vi.fn() };
    const translations = ref({
      settings: {
        exportData: 'Export data',
        exportMessage: 'Exported',
        importData: 'Import data',
        import: 'Import',
        cancel: 'Cancel',
        password: 'Vault key',
      },
      dialog: {},
    });
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

  it('export writes the backup with no password prompt', async () => {
    openDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/out'] });

    await exposed.exportData();

    expect(dialog.prompt).not.toHaveBeenCalled();
    expect(dialog.confirm).not.toHaveBeenCalled();
    const { exportBackup } = await import('@/lib/native/backup');
    expect(exportBackup).toHaveBeenCalledTimes(1);
  });

  it('a lone workspace exports as the active default without a selector', async () => {
    listWorkspacesMock.mockResolvedValue([{ id: 'solo', name: 'Solo' }]);
    openDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/out'] });

    await exposed.exportData();

    expect(dialog.select).not.toHaveBeenCalled();
    const { exportBackup } = await import('@/lib/native/backup');
    const [, workspaces] = exportBackup.mock.calls[0];
    expect(workspaces).toEqual(['solo']);
  });

  it('multiple workspaces show a selector and export the chosen subset', async () => {
    listWorkspacesMock.mockResolvedValue([
      { id: 'alpha', name: 'Alpha' },
      { id: 'beta', name: 'Beta' },
    ]);
    let options;
    dialog.select = vi.fn((opts) => {
      options = opts;
    });
    openDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/out'] });

    const pending = exposed.exportData();
    await vi.waitFor(() => expect(options).toBeDefined());

    expect(options.choices.map((choice) => choice.value)).toEqual([
      'alpha',
      'beta',
    ]);
    expect(options.defaultValues).toEqual(['alpha', 'beta']);

    options.onConfirm(['beta']);
    await pending;

    const { exportBackup } = await import('@/lib/native/backup');
    const [, workspaces] = exportBackup.mock.calls[0];
    expect(workspaces).toEqual(['beta']);
  });

  it('import of a new-style backup prompts no password, only the replace warning', async () => {
    openDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/backup'] });

    await exposed.importData();

    expect(dialog.prompt).not.toHaveBeenCalled();
    expect(dialog.confirm).toHaveBeenCalledTimes(1);

    const confirmOpts = dialog.confirm.mock.calls[0][0];
    await confirmOpts.onConfirm();
    const { importBackup } = await import('@/lib/native/backup');
    expect(importBackup).toHaveBeenCalledWith('/backup');
  });

  it('import of a different-vault backup prompts for the vault key, then imports with it', async () => {
    const { importBackup } = await import('@/lib/native/backup');
    importBackup.mockRejectedValueOnce({
      kind: 'VaultKeyRequired',
      message: 'different vault key',
    });
    openDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/backup'] });

    await exposed.importData();

    expect(dialog.confirm).toHaveBeenCalledTimes(1);
    await dialog.confirm.mock.calls[0][0].onConfirm();

    const { relaunchApp } = await import('@/lib/native/app');
    expect(relaunchApp).not.toHaveBeenCalled();

    expect(dialog.prompt).toHaveBeenCalledTimes(1);
    const opts = dialog.prompt.mock.calls[0][0];
    expect(opts.password).toBe(true);
    expect(opts.title).toContain('Vault key');
    expect(opts.placeholder).toBe('Vault key');
    expect(opts.body).toContain('different vault key');

    const ok = await opts.onConfirm('the-source-vault-key');
    expect(ok).toBe(true);
    expect(importBackup).toHaveBeenLastCalledWith('/backup', 'the-source-vault-key');
    expect(relaunchApp).toHaveBeenCalledTimes(1);
  });

  it('import of a password-protected legacy backup still prompts and restores', async () => {
    const payload = await makeLegacyEncryptedBackup({ notes: {} }, 'old-backup-secret');
    readJsonMock.mockResolvedValue({ data: payload });
    openDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/legacy'] });

    await exposed.importData();

    expect(dialog.prompt).toHaveBeenCalledTimes(1);
    const opts = dialog.prompt.mock.calls[0][0];
    expect(opts.password).toBe(true);
    // Legacy backups use their own export-time password, never the vault key.
    expect(opts.placeholder).toBe('Backup password');

    const ok = await opts.onConfirm('old-backup-secret');
    expect(ok).toBe(true);
  });

  it('import of a legacy backup with the wrong password reports it and does not import', async () => {
    const payload = await makeLegacyEncryptedBackup({ notes: {} }, 'right-secret');
    readJsonMock.mockResolvedValue({ data: payload });
    openDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/legacy'] });

    await exposed.importData();
    const ok = await dialog.prompt.mock.calls[0][0].onConfirm('wrong-secret');

    expect(ok).toBe(false);
    const { copyPath } = await import('@/lib/native/fs');
    expect(copyPath).not.toHaveBeenCalled();
  });
});
