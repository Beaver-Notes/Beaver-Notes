import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { hexToBuf, base64ToBuf, bufToBase64 } from '@/utils/crypto/codec.js';
import dayjs from '@/lib/dayjs';
import { getSettingSync, setSetting } from '@/composable/settings';
import { setSyncPath, getSyncPath } from '@/utils/sync/path.js';
import { forceSyncNow } from '@/utils/sync';
import { listen } from '@tauri-apps/api/event';
import { openDialog, showMessage } from '@/lib/native/dialog';
import { getAppDirectory, relaunchApp, setSpellcheck } from '@/lib/native/app';
import { path } from '@/lib/tauri-bridge';
import {
  copyPath,
  ensureDir,
  readJson,
  removePath,
  writeJson,
} from '@/lib/native/fs';
import { useAppStore } from '@/store/app';
import { bindGlobalShortcuts } from '@/utils/ui/globalShortcuts.js';
import { markRaw } from 'vue';
import {
  clearAssetPassphrase,
  clearSecureBlob,
} from '@/lib/native/security.js';

import {
  ONBOARDING_LANGUAGE_CONFIG,
  getLanguageDirection,
} from '@/utils/onboarding/index.js';

async function encryptSettings(plaintext, password) {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
  );
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode(plaintext));
  return JSON.stringify({
    v: 1,
    salt: Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join(''),
    iv: Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join(''),
    cipher: bufToBase64(new Uint8Array(ct)),
  });
}

async function decryptSettings(ciphertext, password) {
  const parsed = JSON.parse(ciphertext);
  if (parsed?.v !== 1) throw new Error('Unsupported format');
  const salt = hexToBuf(parsed.salt);
  const iv = hexToBuf(parsed.iv);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
  );
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, base64ToBuf(parsed.cipher));
  return new TextDecoder().decode(pt);
}

export function useSettingsData({
  dialog,
  folderStore,
  noteStore: _noteStore,
  passwordStore,
  storage,
  translations,
}) {
  let _unregSettingsShortcuts;

  const appStore = useAppStore();
  const advancedSettings = ref(getSettingSync('advancedSettings'));
  const spellcheckEnabled = ref(getSettingSync('spellcheckEnabled'));
  const autoSync = ref(getSettingSync('autoSync'));
  const selectedFont = ref(getSettingSync('selectedFont'));
  const selectedLanguage = ref(getSettingSync('selectedLanguage'));
  const directionPreference = ref(
    getSettingSync('directionPreference') ||
      getLanguageDirection(selectedLanguage.value)
  );
  const languages = Object.entries(ONBOARDING_LANGUAGE_CONFIG).map(
    ([code, { name }]) => ({
      code,
      name,
    })
  );

  const state = reactive({
    syncPath: '',
    password: '',
    withPassword: false,
    lastUpdated: null,
    zoomLevel: (+getSettingSync('zoomLevel') || 1).toFixed(1),
  });

  const syncProgress = ref(null);
  let unlistenSyncProgress = null;

  const defaultPath = ref('');

  const collapsibleHeading = computed({
    get() {
      return appStore.setting.collapsibleHeading;
    },
    set(value) {
      appStore.setSettingStorage('collapsibleHeading', value);
    },
  });

  const openLastEdited = computed({
    get() {
      return appStore.setting.openLastEdited;
    },
    set(value) {
      appStore.setSettingStorage('openLastEdited', value);
    },
  });

  const soundsEnabled = computed({
    get() {
      return appStore.setting.soundsEnabled;
    },
    set(value) {
      appStore.setting.soundsEnabled = value;
      appStore.setSettingStorage('soundsEnabled', value);
    },
  });

  const spotlightEnabled = computed({
    get() {
      return appStore.setting.spotlightEnabled;
    },
    set(value) {
      appStore.setting.spotlightEnabled = value;
      appStore.setSettingStorage('spotlightEnabled', value);
    },
  });

  const openAfterCreation = computed({
    get() {
      return appStore.setting.openAfterCreation;
    },
    set(value) {
      appStore.setSettingStorage('openAfterCreation', value);
    },
  });

  const todayDateFormat = ref(getSettingSync('todayDateFormat'));
  const timeFormat = ref(getSettingSync('timeFormat'));
  const hasSyncFolder = computed(() => Boolean(state.syncPath?.trim()));

  const dateFormats = [
    { value: 'DD-MM-YYYY', label: '17-02-2026 (DD-MM-YYYY)' },
    { value: 'MM-DD-YYYY', label: '02-17-2026 (MM-DD-YYYY)' },
    { value: 'YYYY-MM-DD', label: '2026-02-17 (ISO)' },
    { value: 'DD/MM/YYYY', label: '17/02/2026 (European)' },
    { value: 'MM/DD/YYYY', label: '02/17/2026 (US)' },
    { value: 'D MMM YYYY', label: '17 Feb 2026' },
    { value: 'MMMM D, YYYY', label: 'February 17, 2026' },
  ];

  const timeFormats = [
    { value: 'HH:mm', label: '14:35 (24h)' },
    { value: 'hh:mm A', label: '02:35 PM (12h)' },
    { value: 'HH:mm:ss', label: '14:35:20' },
  ];

  function showAlert(message, options = {}) {
    showMessage({
      type: 'error',
      title: translations.value.settings.alertTitle || 'Alert',
      message,
      ...options,
    });
  }

  function showDialogAlert(message) {
    dialog.alert({
      title: translations.value.settings.alertTitle || 'Alert',
      body: message,
      okText: translations.value.dialog?.close || 'Close',
    });
  }

  async function getEffectiveAppDirectory() {
    const directory = await getAppDirectory();
    return typeof directory === 'string' ? directory.trim() : '';
  }

  async function exportData() {
    try {
      const appDirectory = await getEffectiveAppDirectory();
      const { canceled, filePaths } = await openDialog({
        title: translations.value.settings.exportData,
        properties: ['openDirectory'],
        useScopedStorage: true,
      });

      if (canceled) return;

      let data = await storage.store();
      data.sharedKey = storage.get('sharedKey');
      data.lockedNotes = JSON.parse(localStorage.getItem('lockedNotes'));
      await passwordStore.retrieve();
      data.sharedKey = passwordStore.sharedKey;

      if (state.withPassword) {
        data = await encryptSettings(JSON.stringify(data), state.password);
      }

      const folderName = dayjs().format('[Beaver Notes] YYYY-MM-DD');
      const folderPath = path.join(filePaths[0], folderName);

      await ensureDir(folderPath);
      await writeJson(path.join(folderPath, 'data.json'), { data });
      await copyPath(
        path.join(appDirectory, 'notes-assets'),
        path.join(folderPath, 'assets')
      );
      await copyPath(
        path.join(appDirectory, 'file-assets'),
        path.join(folderPath, 'file-assets')
      );

      if (!folderPath.includes('gvfs')) {
        showDialogAlert(
          `${translations.value.settings.exportMessage}"${folderName}"`
        );
      }

      state.withPassword = false;
      state.password = '';
    } catch (error) {
      console.error(error);
    }
  }

  async function mergeImportedData(data) {
    try {
      const keys = [
        { key: 'notes', dfData: {} },
        { key: 'labels', dfData: [] },
        { key: 'lockStatus', dfData: {} },
        { key: 'isLocked', dfData: {} },
        { key: 'folders', dfData: {} },
      ];

      for (const { key, dfData } of keys) {
        const currentData = await storage.get(key, dfData);
        const importedData = data[key] ?? dfData;
        const mergedData =
          key === 'labels'
            ? [...new Set([...currentData, ...importedData])]
            : { ...currentData, ...importedData };

        await storage.set(key, mergedData);
        await folderStore.retrieve();
      }
    } catch (error) {
      console.error(error);
    }
  }

  async function importData() {
    try {
      const appDirectory = await getEffectiveAppDirectory();
      const {
        canceled,
        filePaths: [dirPath],
      } = await openDialog({
        title: translations.value.settings.importData,
        properties: ['openDirectory'],
        useScopedStorage: true,
      });

      if (canceled) return;

      let { data } = await readJson(path.join(dirPath, 'data.json'));
      if (!data) {
        showAlert(translations.value.settings.invalidData);
        return;
      }

      const finishImport = async (result) => {
        await mergeImportedData(result);

        if (result.sharedKey) {
          await passwordStore.importSharedKey(result.sharedKey);
        }

        if (result.lockStatus !== null && result.lockStatus !== undefined) {
          localStorage.setItem('lockStatus', JSON.stringify(result.lockStatus));
        }

        if (result.isLocked !== null && result.isLocked !== undefined) {
          localStorage.setItem('isLocked', JSON.stringify(result.isLocked));
        }

        await copyPath(
          path.join(dirPath, 'assets'),
          path.join(appDirectory, 'notes-assets')
        );
        await copyPath(
          path.join(dirPath, 'file-assets'),
          path.join(appDirectory, 'file-assets')
        );
      };

      if (typeof data === 'string') {
        dialog.prompt({
          title: translations.value.settings.inputPassword,
          body: translations.value.settings.body,
          okText: translations.value.settings.import,
          cancelText: translations.value.settings.cancel,
          placeholder: translations.value.settings.password,
          onConfirm: async (pass) => {
            try {
              const result = await decryptSettings(data, pass);
              await finishImport(JSON.parse(result));
            } catch {
              showAlert(translations.value.settings.invalidPassword);
              return false;
            }
          },
        });
        return;
      }

      await finishImport(data);
    } catch (error) {
      console.error(error);
    }
  }

  async function chooseDefaultPath() {
    try {
      const {
        canceled,
        filePaths: [dir],
      } = await openDialog({
        title: translations.value.settings.selectPath,
        properties: ['openDirectory'],
        useScopedStorage: true,
      });

      if (canceled) return;
      defaultPath.value = await setSyncPath(dir);
      state.syncPath = defaultPath.value;
      forceSyncNow().catch(() => {});
    } catch (error) {
      console.error(error);
    }
  }

  async function clearPath() {
    defaultPath.value = '';
    state.syncPath = '';
    await setSyncPath('');
  }

  async function nukeAppDebugOnly() {
    if (!import.meta.env.DEV) {
      return;
    }

    dialog.confirm({
      title: translations.value.settings?.debugResetApp || 'Debug reset app?',
      body: translations.value.settings?.debugResetDescription || 'This will permanently delete local notes, folders, labels, settings, cached encryption keys, and local asset files on this device, then relaunch the app into a fresh state.',
      okText: translations.value.settings?.debugNukeApp || 'Nuke app',
      cancelText: translations.value.dialog?.cancel || 'Cancel',
      okVariant: 'danger',
      onConfirm: async () => {
        try {
          const appDirectory = await getEffectiveAppDirectory().catch(() => '');

          const cleanupPaths = [
            appDirectory ? path.join(appDirectory, 'notes-assets') : '',
            appDirectory ? path.join(appDirectory, 'file-assets') : '',
            appDirectory ? path.join(appDirectory, 'app-crypto') : '',
          ].filter(Boolean);

          await Promise.allSettled([
            ...cleanupPaths.map((targetPath) => removePath(targetPath)),
            storage.clear('data'),
            storage.clear('settings'),
            clearSecureBlob('encryptionPassphraseBlob'),
            clearAssetPassphrase(),
            setSyncPath(''),
          ]);

          localStorage.clear();
          sessionStorage.clear();

          await relaunchApp();
        } catch (error) {
          console.error('Error nuking app in debug mode:', error);
          showAlert('Debug reset failed. Check the console for details.');
          return false;
        }
      },
    });
  }

  const handleAutoSyncChange = () => {
    if (!defaultPath.value || defaultPath.value.trim() === '') {
      autoSync.value = false;
      showAlert(translations.value.settings.emptyPathWarn);
      return;
    }

    void setSetting('autoSync', autoSync.value);
    if (autoSync.value) {
      forceSyncNow().catch(() => {});
    }
  };

  const toggleAdvancedSettings = () => {
    void setSetting('advancedSettings', advancedSettings.value);
  };

  const toggleSpellcheck = () => {
    void setSetting('spellcheckEnabled', spellcheckEnabled.value);
    applySpellcheckAttribute();
  };

  const applySpellcheckAttribute = () => {
    const inputElements = document.querySelectorAll(
      'input, textarea, [contenteditable="true"]'
    );
    inputElements.forEach((element) => {
      element.setAttribute('spellcheck', spellcheckEnabled.value);
      setSpellcheck(spellcheckEnabled.value);
    });
  };

  const updateLanguage = () => {
    const languageCode = selectedLanguage.value;
    const dir = getLanguageDirection(languageCode);
    void Promise.all([
      setSetting('selectedLanguage', languageCode),
      setSetting('directionPreference', dir),
    ]).then(() => window.location.reload());
  };

  const saveTodayDateFormat = () => {
    if (todayDateFormat.value.trim() === '') {
      todayDateFormat.value = 'DD-MM-YYYY';
    }
    void setSetting('todayDateFormat', todayDateFormat.value);
  };

  const saveTimeFormat = () => {
    if (timeFormat.value.trim() === '') {
      timeFormat.value = 'HH:mm';
    }
    void setSetting('timeFormat', timeFormat.value);
  };

  function registerSyncProgressListener() {
    if (unlistenSyncProgress) return;
    (async () => {
      unlistenSyncProgress = await listen('sync:progress', (event) => {
        syncProgress.value = markRaw(event.payload);
      });
    })();
  }

  function unregisterSyncProgressListener() {
    if (unlistenSyncProgress) {
      unlistenSyncProgress();
      unlistenSyncProgress = null;
    }
  }

  onMounted(() => {
    void (async () => {
      defaultPath.value = await getSyncPath();
      state.syncPath = defaultPath.value;
    })();
  });

  onMounted(() => {
    _unregSettingsShortcuts = bindGlobalShortcuts({
      'mod+s': importData,
      'mod+shift+e': exportData,
    });
  });
  onUnmounted(() => _unregSettingsShortcuts?.());

  return {
    LANGUAGE_CONFIG: ONBOARDING_LANGUAGE_CONFIG,
    getLanguageDirection,
    state,
    defaultPath,
    advancedSettings,
    spellcheckEnabled,
    autoSync,
    selectedFont,
    selectedLanguage,
    directionPreference,
    languages,
    collapsibleHeading,
    openLastEdited,
    openAfterCreation,
    todayDateFormat,
    timeFormat,
    dateFormats,
    timeFormats,
    hasSyncFolder,
    exportData,
    importData,
    chooseDefaultPath,
    clearPath,
    nukeAppDebugOnly,
    handleAutoSyncChange,
    syncProgress,
    registerSyncProgressListener,
    unregisterSyncProgressListener,
    toggleAdvancedSettings,
    toggleSpellcheck,
    applySpellcheckAttribute,
    updateLanguage,
    saveTodayDateFormat,
    saveTimeFormat,
    showAlert,
    showDialogAlert,
    getEffectiveAppDirectory,
    soundsEnabled,
    spotlightEnabled,
  };
}
