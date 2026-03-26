import { computed, onMounted, reactive, ref } from 'vue';
import { AES } from 'crypto-es/lib/aes';
import { Utf8 } from 'crypto-es/lib/core';
import dayjs from '@/lib/dayjs';
import { getSettingSync, setSetting } from '@/composable/settings';
import { setSyncPath, getSyncPath } from '@/utils/syncPath.js';
import { openDialog, showMessage } from '@/lib/native/dialog';
import { getHelperPath, setSpellcheck } from '@/lib/native/app';
import { path } from '@/lib/tauri-bridge';
import { copyPath, ensureDir, readJson, writeJson } from '@/lib/native/fs';
import { useAppStore } from '@/store/app';
import { useGlobalShortcuts } from '@/composable/useGlobalShortcuts';

const LANGUAGE_CONFIG = {
  ar: { name: 'العربية', dir: 'rtl' },
  de: { name: 'Deutsch', dir: 'ltr' },
  en: { name: 'English', dir: 'ltr' },
  es: { name: 'Español', dir: 'ltr' },
  fr: { name: 'Français', dir: 'ltr' },
  it: { name: 'Italiano', dir: 'ltr' },
  nl: { name: 'Nederlands', dir: 'ltr' },
  pt: { name: 'Português', dir: 'ltr' },
  ru: { name: 'Русский', dir: 'ltr' },
  tr: { name: 'Türkçe', dir: 'ltr' },
  uk: { name: 'Українська', dir: 'ltr' },
  zh: { name: '简体中文', dir: 'ltr' },
  vi: { name: 'Tiếng Việt', dir: 'ltr' },
};

const getLanguageDirection = (languageCode) =>
  LANGUAGE_CONFIG[languageCode]?.dir || 'ltr';

export function useSettingsData({
  dialog,
  folderStore,
  noteStore,
  passwordStore,
  storage,
  translations,
}) {
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
  const languages = Object.entries(LANGUAGE_CONFIG).map(([code, { name }]) => ({
    code,
    name,
  }));

  const state = reactive({
    dataDir: '',
    password: '',
    withPassword: false,
    lastUpdated: null,
    zoomLevel: (+getSettingSync('zoomLevel') || 1).toFixed(1),
  });

  let defaultPath = '';

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
  const hasSyncFolder = computed(() => Boolean(state.dataDir?.trim()));

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

  async function getEffectiveDataDir() {
    const storedDataDir = await storage.get('dataDir', '', 'settings');
    if (typeof storedDataDir === 'string' && storedDataDir.trim()) {
      return storedDataDir.trim();
    }

    const userDataDir = await getHelperPath('userData');
    return typeof userDataDir === 'string' ? userDataDir.trim() : '';
  }

  async function changeDataDir() {
    try {
      const {
        canceled,
        filePaths: [dir],
      } = await openDialog({
        title: translations.value.settings.selectPath,
        properties: ['openDirectory'],
      });

      if (canceled) return;

      showAlert(translations.value.settings.relaunch, {
        type: 'info',
        buttons: [translations.value.settings.relaunchButton],
      });

      await storage.set('dataDir', dir);
      window.location.reload();
    } catch (error) {
      if (
        String(error?.message || error).includes(
          'No matching entry found in secure storage'
        )
      ) {
        return;
      }
      console.error(error);
    }
  }

  async function exportData() {
    try {
      const dataDir = await getEffectiveDataDir();
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
        data = AES.encrypt(JSON.stringify(data), state.password).toString();
      }

      const folderName = dayjs().format('[Beaver Notes] YYYY-MM-DD');
      const folderPath = path.join(filePaths[0], folderName);

      await ensureDir(folderPath);
      await writeJson(path.join(folderPath, 'data.json'), { data });
      await copyPath(
        path.join(dataDir, 'notes-assets'),
        path.join(folderPath, 'assets')
      );
      await copyPath(
        path.join(dataDir, 'file-assets'),
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
      const dataDir = await getEffectiveDataDir();
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
          await passwordStore.importSharedKey(
            result.sharedKey,
            result.derivedKey
          );
        }

        if (result.lockStatus !== null && result.lockStatus !== undefined) {
          localStorage.setItem('lockStatus', JSON.stringify(result.lockStatus));
        }

        if (result.isLocked !== null && result.isLocked !== undefined) {
          localStorage.setItem('isLocked', JSON.stringify(result.isLocked));
        }

        if (result.dataDir) {
          await setSyncPath(result.dataDir);
        }

        await copyPath(
          path.join(dirPath, 'assets'),
          path.join(dataDir, 'notes-assets')
        );
        await copyPath(
          path.join(dirPath, 'file-assets'),
          path.join(dataDir, 'file-assets')
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
              const bytes = AES.decrypt(data, pass);
              const result = bytes.toString(Utf8);
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
      defaultPath = await setSyncPath(dir);
      state.dataDir = defaultPath;
      window.location.reload();
    } catch (error) {
      console.error(error);
    }
  }

  async function clearPath() {
    state.dataDir = '';
    await setSyncPath('');
  }

  const handleAutoSyncChange = () => {
    if (!defaultPath || defaultPath.trim() === '') {
      showAlert(translations.value.settings.emptyPathWarn);
      return;
    }

    const nextValue = !autoSync.value;
    autoSync.value = nextValue;
    void setSetting('autoSync', nextValue);
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

  onMounted(() => {
    void (async () => {
      defaultPath = await getSyncPath();
      state.dataDir = defaultPath;
    })();
  });

  useGlobalShortcuts(() => ({
    'mod+s': importData,
    'mod+shift+e': exportData,
  }));

  return {
    LANGUAGE_CONFIG,
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
    changeDataDir,
    exportData,
    importData,
    chooseDefaultPath,
    clearPath,
    handleAutoSyncChange,
    toggleAdvancedSettings,
    toggleSpellcheck,
    applySpellcheckAttribute,
    updateLanguage,
    saveTodayDateFormat,
    saveTimeFormat,
    showAlert,
    showDialogAlert,
    getEffectiveDataDir,
  };
}
