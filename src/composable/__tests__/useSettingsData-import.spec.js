import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  openDialogMock,
  showMessageMock,
  readJsonMock,
  copyPathMock,
  verifyPassphraseMock,
  ensureKeyReadyForWriteMock,
  getAppDirectoryMock,
} = vi.hoisted(() => ({
  openDialogMock: vi.fn(),
  showMessageMock: vi.fn(),
  readJsonMock: vi.fn(),
  copyPathMock: vi.fn(async () => {}),
  verifyPassphraseMock: vi.fn(),
  ensureKeyReadyForWriteMock: vi.fn(async () => true),
  getAppDirectoryMock: vi.fn(async () => '/app'),
}));

vi.mock('@/lib/tauri-bridge', () => ({
  backend: { isMobileRuntime: () => false },
  path: { join: (...parts) => parts.join('/') },
}));

vi.mock('@/lib/native/dialog', () => ({
  openDialog: (...args) => openDialogMock(...args),
  showMessage: (...args) => showMessageMock(...args),
}));

vi.mock('@/lib/native/fs', () => ({
  readJson: (...args) => readJsonMock(...args),
  copyPath: (...args) => copyPathMock(...args),
  ensureDir: vi.fn(async () => {}),
  writeJson: vi.fn(async () => {}),
  removePath: vi.fn(async () => {}),
}));

vi.mock('@/lib/native/app', () => ({
  getAppDirectory: (...args) => getAppDirectoryMock(...args),
  relaunchApp: vi.fn(),
  setSpellcheck: vi.fn(),
}));

vi.mock('@/utils/crypto/encryption.js', () => ({
  verifyPassphrase: (...args) => verifyPassphraseMock(...args),
  ensureKeyReadyForWrite: (...args) => ensureKeyReadyForWriteMock(...args),
}));

vi.mock('@/store/app', () => ({
  useAppStore: () => ({ setting: {}, setSettingStorage: vi.fn() }),
}));

vi.mock('@/store/i18n', () => ({
  useI18nStore: () => ({ setLanguage: vi.fn() }),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => async () => {}),
}));

import { bufToHex, bufToBase64 } from '@/utils/crypto/codec.js';
import { useSettingsData } from '../useSettingsData.js';

const SETTINGS_KEYS = {
  inputPassword: 'Input password',
  body: 'This data is encrypted, you need to input the password to get access',
  import: 'Import',
  cancel: 'Cancel',
  password: 'Password',
  invalidData: 'Invalid data',
  invalidPassword: 'Invalid password',
  wrongBackupPassword: 'Wrong backup password',
  wrongWorkspacePassphrase: 'Wrong workspace passphrase',
  alertTitle: 'Alert',
};

const EXPORT_OBJECT = {
  notes: { a: { id: 'a', title: 'Imported note' } },
  labels: [],
  lockStatus: {},
  isLocked: {},
  folders: {},
};

// Reproduces the legacy `encryptSettings` backup format (`v:1` PBKDF2
// envelope) so the string-import branch decrypts with a real round trip.
async function encryptSettingsLike(plaintext, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(plaintext)
    )
  );
  return JSON.stringify({
    v: 1,
    salt: bufToHex(salt),
    iv: bufToHex(iv),
    cipher: bufToBase64(ct),
  });
}

function setup() {
  const storage = {
    get: vi.fn(async (_key, dfData = {}) =>
      Array.isArray(dfData) ? [...dfData] : { ...dfData }
    ),
    set: vi.fn(async () => {}),
  };
  const folderStore = { retrieve: vi.fn() };
  const dialog = { prompt: vi.fn(), alert: vi.fn(), confirm: vi.fn() };
  const translations = { value: { settings: SETTINGS_KEYS } };

  const settings = useSettingsData({
    dialog,
    folderStore,
    noteStore: {},
    storage,
    translations,
  });

  return { settings, dialog, storage, folderStore, translations };
}

describe('useSettingsData.importData', () => {
  beforeEach(() => {
    openDialogMock.mockReset();
    showMessageMock.mockReset();
    readJsonMock.mockReset();
    copyPathMock.mockReset();
    verifyPassphraseMock.mockReset();
    ensureKeyReadyForWriteMock.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('new workspace-encrypted export (object)', () => {
    it('requires the workspace passphrase and merges only when verifyPassphrase succeeds', async () => {
      verifyPassphraseMock.mockResolvedValue({ ok: true });

      const { settings, dialog, storage } = setup();
      openDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/backup/dir'] });
      readJsonMock.mockResolvedValue({ data: EXPORT_OBJECT });

      await settings.importData();
      const promptOptions = dialog.prompt.mock.calls[0][0];
      expect(promptOptions.password).toBe(true);

      const result = await promptOptions.onConfirm('workspace-passphrase');

      expect(result).toBe(true);
      expect(verifyPassphraseMock).toHaveBeenCalledWith('workspace-passphrase');
      expect(storage.set).toHaveBeenCalledWith('notes', EXPORT_OBJECT.notes);
      expect(localStorage.getItem('lockStatus')).toBe(
        JSON.stringify(EXPORT_OBJECT.lockStatus)
      );
    });

    it('does not merge when the workspace passphrase is wrong and shows a distinct error', async () => {
      verifyPassphraseMock.mockResolvedValue({
        ok: false,
        error: 'Wrong passphrase.',
      });

      const { settings, dialog, storage } = setup();
      openDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/backup/dir'] });
      readJsonMock.mockResolvedValue({ data: EXPORT_OBJECT });

      await settings.importData();
      const promptOptions = dialog.prompt.mock.calls[0][0];

      const result = await promptOptions.onConfirm('wrong-passphrase');

      expect(result).toBe(false);
      expect(storage.set).not.toHaveBeenCalled();
      expect(showMessageMock).toHaveBeenCalledTimes(1);
      expect(showMessageMock.mock.calls[0][0].message).toBe(
        SETTINGS_KEYS.wrongWorkspacePassphrase
      );
      // Distinct from the backup-password error.
      expect(showMessageMock.mock.calls[0][0].message).not.toBe(
        SETTINGS_KEYS.wrongBackupPassword
      );
    });
  });

  describe('legacy encryptSettings backup (string)', () => {
    it('decrypts with the backup password and does NOT verify the workspace passphrase', async () => {
      const backup = await encryptSettingsLike(
        JSON.stringify(EXPORT_OBJECT),
        'backup-password'
      );

      const { settings, dialog, storage } = setup();
      openDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/backup/dir'] });
      readJsonMock.mockResolvedValue({ data: backup });

      await settings.importData();
      const promptOptions = dialog.prompt.mock.calls[0][0];

      const result = await promptOptions.onConfirm('backup-password');

      expect(result).toBe(true);
      // The backup password is legacy and arbitrary — it must never be routed
      // through the workspace passphrase verifier.
      expect(verifyPassphraseMock).not.toHaveBeenCalled();
      expect(storage.set).toHaveBeenCalledWith('notes', EXPORT_OBJECT.notes);
      expect(storage.set).toHaveBeenCalledWith('labels', []);
    });

    it('shows a distinct "wrong backup password" error and does not merge', async () => {
      const backup = await encryptSettingsLike(
        JSON.stringify(EXPORT_OBJECT),
        'backup-password'
      );

      const { settings, dialog, storage } = setup();
      openDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/backup/dir'] });
      readJsonMock.mockResolvedValue({ data: backup });

      await settings.importData();
      const promptOptions = dialog.prompt.mock.calls[0][0];

      const result = await promptOptions.onConfirm('wrong-backup-password');

      expect(result).toBe(false);
      expect(verifyPassphraseMock).not.toHaveBeenCalled();
      expect(storage.set).not.toHaveBeenCalled();
      expect(showMessageMock).toHaveBeenCalledTimes(1);
      expect(showMessageMock.mock.calls[0][0].message).toBe(
        SETTINGS_KEYS.wrongBackupPassword
      );
      expect(showMessageMock.mock.calls[0][0].message).not.toBe(
        SETTINGS_KEYS.wrongWorkspacePassphrase
      );
    });
  });

  it('refuses an empty password without decrypting or verifying', async () => {
    const { settings, dialog, storage } = setup();
    openDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/backup/dir'] });
    readJsonMock.mockResolvedValue({ data: EXPORT_OBJECT });

    await settings.importData();
    const promptOptions = dialog.prompt.mock.calls[0][0];

    const result = await promptOptions.onConfirm('');

    expect(result).toBe(false);
    expect(verifyPassphraseMock).not.toHaveBeenCalled();
    expect(storage.set).not.toHaveBeenCalled();
    expect(showMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: SETTINGS_KEYS.invalidPassword })
    );
  });
});
