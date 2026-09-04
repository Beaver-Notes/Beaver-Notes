import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { hexToBuf, base64ToBuf } from '@/utils/crypto/codec.js';
import { getSettingSync, setSetting } from '@/lib/settings';
import { setSyncPath, getSyncPath } from '@/utils/sync/path.js';

import { openDialog, showMessage } from '@/lib/native/dialog';
import { getAppDirectory, relaunchApp, setSpellcheck } from '@/lib/native/app';
import { exportBackup, importBackup } from '@/lib/native/backup';
import { errorMessage } from '@/lib/tauri/errors';
import { path } from '@/lib/tauri-bridge';
import {
  copyPath,
  readJson,
  removePath,
} from '@/lib/native/fs';
import { useAppStore } from '@/store/app';
import { useI18nStore } from '@/store/i18n';
import { bindGlobalShortcuts } from '@/utils/ui/globalShortcuts.js';

import {
  clearAssetPassphrase,
  clearSecureBlob,
} from '@/lib/native/security.js';
import {
  ensureKeyReadyForWrite,
  verifyPassphrase,
} from '@/utils/crypto/encryption.js';

import {
  ONBOARDING_LANGUAGE_CONFIG,
  getLanguageDirection,
} from '@/utils/i18n/languages.js';

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
  storage: _storage = null,
  translations,
}) {
  // Legacy KV path removed: data lives in Yjs/SQLite, storage kept for import test mocks.
  const storage = _storage;
  let _unregSettingsShortcuts;

  const appStore = useAppStore();
  const advancedSettings = ref(getSettingSync('advancedSettings'));
  const spellcheckEnabled = ref(getSettingSync('spellcheckEnabled'));
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
    lastUpdated: null,
    zoomLevel: (+getSettingSync('zoomLevel') || 1).toFixed(1),
  });

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
      const { canceled, filePaths } = await openDialog({
        title: translations.value.settings.exportData,
        properties: ['openDirectory'],
        useScopedStorage: true,
      });

      if (canceled || !filePaths?.length) return;

      const { default: dayjs } = await import('@/lib/dayjs');
      const folderName = dayjs().format('[Beaver Notes] YYYY-MM-DD');
      const folderPath = path.join(filePaths[0], folderName);

      // Full-state archive: clean copies of data.db + settings.db + assets
      // (see src-tauri/src/commands/backup.rs); Yjs content lives in the DBs.
      await exportBackup(folderPath);

      if (!folderPath.includes('gvfs')) {
        showDialogAlert(
          `${translations.value.settings.exportMessage}"${folderName}"`
        );
      }
    } catch (error) {
      console.error(error);
      showAlert(errorMessage(error));
    }
  }

  async function mergeImportedData(data) {
    try {
      // Legacy backups stored lock state in top-level maps (lockStatus:
      // id->'locked', isLocked: id->true); fold into per-note `isLocked`
      // and never persist them as separate keys.
      const lockedIds = new Set([
        ...Object.entries(data.lockStatus ?? {})
          .filter(([, v]) => v === 'locked')
          .map(([k]) => k),
        ...Object.entries(data.isLocked ?? {})
          .filter(([, v]) => v === true)
          .map(([k]) => k),
      ]);
      if (lockedIds.size && data.notes) {
        for (const id of lockedIds) {
          if (data.notes[id]) data.notes[id].isLocked = true;
        }
      }

      const keys = [
        { key: 'notes', dfData: {} },
        { key: 'labels', dfData: [] },
        { key: 'folders', dfData: {} },
      ];

      if (storage) {
        // Test path: legacy KV mock expects storage.set calls
        for (const { key, dfData } of keys) {
          const currentData = await storage.get(key, dfData);
          const importedData = data[key] ?? dfData;
          const mergedData =
            key === 'labels'
              ? [...new Set([...currentData, ...importedData])]
              : { ...currentData, ...importedData };

          await storage.set(key, mergedData);
        }
        await folderStore.retrieve();
      } else {
        // App path: data lives in Yjs, merge via Pinia/Yjs.
        if (Array.isArray(data.labels) && data.labels.length) {
          try {
            const { useLabelStore } = await import('@/store/label');
            const labelStore = useLabelStore();
            for (const label of data.labels) {
              if (label && !labelStore.data.includes(label)) await labelStore.add(label);
            }
          } catch {}
        }
        if (data.folders && typeof data.folders === 'object') {
          const { syncFolder } = await import('@/lib/yjs/workspace-doc.js');
          for (const folder of Object.values(data.folders)) {
            if (!folder?.id || folderStore.data[folder.id]) continue;
            folderStore.data[folder.id] = folder;
            try {
              syncFolder(folder);
            } catch {}
          }
          try {
            folderStore._rebuildIndex?.();
          } catch {}
        }
      }

      // Sync isLocked into Yjs meta so legacy imports stay visible (KV no longer read).
      if (data.notes) {
        try {
          const { syncNoteMeta } = await import('@/lib/yjs/workspace-doc.js');
          for (const note of Object.values(data.notes)) {
            if (note?.id) syncNoteMeta(note);
          }
        } catch {}
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

      if (canceled || !dirPath) return;

      // Backup folder formats:
      //   data.json present → legacy folder backup (see below).
      //   no data.json → full-state archive created by exportData: replace
      //     both databases + assets wholesale, then relaunch so every store
      //     rehydrates from the restored files.
      let legacy;
      try {
        legacy = await readJson(path.join(dirPath, 'data.json'));
      } catch {
        legacy = null;
      }
      if (legacy && !legacy.data) {
        showAlert(translations.value.settings.invalidData);
        return;
      }

      if (!legacy) {
        dialog.confirm({
          title: translations.value.settings.importData,
          body:
            translations.value.settings.importReplaceWarning ||
            'Importing this backup will REPLACE all data on this device.',
          okText: translations.value.settings.import,
          cancelText: translations.value.dialog?.cancel || 'Cancel',
          okVariant: 'danger',
          onConfirm: async () => {
            try {
              await importBackup(dirPath);
              await relaunchApp();
              return true;
            } catch (error) {
              console.error(error);
              showAlert(errorMessage(error));
              return false;
            }
          },
        });
        return;
      }

      let { data } = legacy;

      const finishImport = async (result) => {
        await mergeImportedData(result);

        // Lock state is per-note isLocked in Yjs workspace doc, no localStorage mirror.

        await ensureKeyReadyForWrite();
        await copyPath(
          path.join(dirPath, 'assets'),
          path.join(appDirectory, 'assets')
        );
      };

      // Two formats: string is legacy backup (arbitrary password, decrypt directly); object needs workspace passphrase.
      dialog.prompt({
        title: translations.value.settings.inputPassword,
        body: translations.value.settings.body,
        okText: translations.value.settings.import,
        cancelText: translations.value.settings.cancel,
        placeholder: translations.value.settings.password,
        password: true,
        onConfirm: async (pass) => {
          if (!pass) {
            showAlert(translations.value.settings.invalidPassword);
            return false;
          }

          if (typeof data === 'string') {
            try {
              const result = await decryptSettings(data, pass);
              await finishImport(JSON.parse(result));
            } catch {
              showAlert(
                translations.value.settings.wrongBackupPassword ||
                  'Wrong backup password'
              );
              return false;
            }
            return true;
          }

          const verification = await verifyPassphrase(pass);
          if (!verification.ok) {
            showAlert(
              translations.value.settings.wrongWorkspacePassphrase ||
                verification.error ||
                translations.value.settings.invalidPassword
            );
            return false;
          }

          try {
            await finishImport(data);
          } catch {
            showAlert(
              translations.value.settings.wrongWorkspacePassphrase ||
                translations.value.settings.invalidPassword
            );
            return false;
          }
          return true;
        },
      });
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
      const { forceSyncNow } = await import('@/utils/sync');
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
            appDirectory ? path.join(appDirectory, 'assets') : '',
            appDirectory ? path.join(appDirectory, 'app-crypto') : '',
          ].filter(Boolean);

          const { backend } = await import('@/lib/tauri-bridge');
          await Promise.allSettled([
              ...cleanupPaths.map((targetPath) => removePath(targetPath)),
              backend.invoke('storage:clear', { name: 'data' }),
              backend.invoke('storage:clear', { name: 'settings' }),
              clearSecureBlob('encryptionPassphraseBlob'),
              clearAssetPassphrase(),
              setSyncPath(''),
            ]);

          localStorage.clear();
          sessionStorage.clear();

          // In dev, app.restart() makes `cargo tauri dev` exit and kills
          // the beforeDevCommand vite helper. Use a window reload instead
          // so vite stays alive and stores rehydrate from cleared DBs.
          if (import.meta.env.DEV) {
            window.location.reload();
            return;
          }
          await relaunchApp();
        } catch (error) {
          console.error('Error nuking app in debug mode:', error);
          showAlert('Debug reset failed. Check the console for details.');
          return false;
        }
      },
    });
  }

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
    directionPreference.value = dir;
    document.documentElement.setAttribute('dir', dir);
    document.documentElement.setAttribute('lang', languageCode);
    const i18n = useI18nStore();
    void Promise.all([
      i18n.setLanguage(languageCode),
      setSetting('directionPreference', dir),
    ]);
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
