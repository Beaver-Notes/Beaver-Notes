<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="general space-y-8 mb-14 w-full max-w-xl">
    <section>
      <p class="mb-2">{{ translations.settings.security || '-' }}</p>
      <ui-button class="w-full" @click="resetPasswordDialog">{{
        translations.settings.resetPassword
      }}</ui-button>
    </section>
    <section>
      <p class="mb-2">{{ t(translations.settings.authorizedApplications) }}</p>
      <div
        v-if="appStore.authRecords.length === 0"
        class="bg-[#F2F2F2] dark:bg-[#2D2D2D] px-2 rounded-xl"
      >
        <div class="space-y-0 py-2">
          {{ translations.settings.noAuthorizedApplicaitons || '-' }}
        </div>
      </div>
      <div v-else class="bg-[#F2F2F2] dark:bg-[#2D2D2D] px-2 rounded-xl">
        <div
          v-for="(auth, index) in appStore.authRecords"
          :key="auth.id"
          class="space-y-1"
        >
          <div
            class="items-center py-2 justify-between"
            :class="{ 'border-b-2': index !== appStore.authRecords.length - 1 }"
          >
            <div class="flex flex-col">
              <div class="text-lg gap-1">
                <div>{{ auth.name }}</div>
                <div
                  v-if="auth.auth !== '' && auth.auth != null"
                  class="text-sm"
                >
                  <p class="mb-1">
                    {{ t(translations.settings.permissions) }}:
                  </p>
                  <div class="flex flex-wrap gap-1">
                    <span
                      v-for="p in auth.auth.split(',')"
                      :key="p"
                      class="py-0.5 px-1 rounded-md bg-primary text-amber-500 bg-opacity-10 dark:text-amber-400"
                    >
                      {{ p }}
                    </span>
                  </div>
                </div>
              </div>
              <div class="text-sm">
                <span>{{ t(translations.settings.id) }}: {{ auth.id }}</span>
              </div>
              <div class="flex flex-col">
                <div class="text-sm gap-1">
                  <div>
                    {{ t(translations.settings.platform) }}: {{ auth.platform }}
                  </div>
                  <div>
                    {{ t(translations.settings.createdAt) }}:
                    {{ formatTime(auth.createdAt) }}
                  </div>
                </div>
              </div>
              <div class="w-full pt-2">
                <div class="flex flex-col-2 gap-2">
                  <ui-button
                    class="w-full"
                    @click="
                      toggleAuth(auth, !authorizatedApps[index]);
                      authorizatedApps[index] = !authorizatedApps[index];
                    "
                  >
                    <span v-if="authorizatedApps[index]">{{
                      t(translations.settings.disable)
                    }}</span>
                    <span v-else>{{ t(translations.settings.enable) }}</span>
                  </ui-button>
                  <button
                    class="w-full ui-button h-10 relative transition focus:ring-2 ring-amber-300 bg-primary text-white dark:bg-secondary dark:hover:bg-primary hover:bg-secondary rounded-lg"
                    @click="() => deleteAuth(auth)"
                  >
                    {{ t(translations.settings.revoke) }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script>
import { shallowReactive, onMounted, ref, watch } from 'vue';
import { AES } from 'crypto-es/lib/aes';
import { Utf8 } from 'crypto-es/lib/core';
import { useTheme } from '@/composable/theme';
import { useStorage } from '@/composable/storage';
import { useDialog } from '@/composable/dialog';
import dayjs from '@/lib/dayjs';
import lightImg from '@/assets/images/light.png';
import darkImg from '@/assets/images/dark.png';
import systemImg from '@/assets/images/system.png';
import Mousetrap from '@/lib/mousetrap';
import { usePasswordStore } from '@/store/passwd';
import { formatTime } from '@/utils/time-format';
import '../../assets/css/passwd.css';
import { useAppStore } from '../../store/app';
import { t } from '@/utils/translations';

const deTranslations = import('../../pages/settings/locales/de.json');
const enTranslations = import('../../pages/settings/locales/en.json');
const esTranslations = import('../../pages/settings/locales/es.json');
const itTranslations = import('../../pages/settings/locales/it.json');
const nlTranslations = import('../../pages/settings/locales/nl.json');
const zhTranslations = import('../../pages/settings/locales/zh.json');
const ukTranslations = import('../../pages/settings/locales/uk.json');

export const state = shallowReactive({
  dataDir: '',
  directionPreference: localStorage.getItem('directionPreference') || 'ltr',
});
export const dataDir = state.dataDir;

export default {
  setup() {
    const { ipcRenderer, path } = window.electron;
    const themes = [
      { name: 'light', img: lightImg },
      { name: 'dark', img: darkImg },
      { name: 'system', img: systemImg },
    ];

    const theme = useTheme();
    // eslint-disable-next-line no-unused-vars
    const dialog = useDialog();
    const storage = useStorage();

    const state = shallowReactive({
      dataDir: '',
      password: '',
      withPassword: false,
      lastUpdated: null,
      zoomLevel: (+localStorage.getItem('zoomLevel') || 1).toFixed(1),
    });

    let defaultPath = '';

    async function changeDataDir() {
      try {
        const {
          canceled,
          filePaths: [dir],
        } = await ipcRenderer.callMain('dialog:open', {
          title: 'Select directory',
          properties: ['openDirectory'],
        });

        if (canceled) return;

        showAlert(translations.settings.relaunch, {
          type: 'info',
          buttons: [translations.settings.relaunchbutton],
        });

        await storage.set('dataDir', dir);
        window.location.reload(); // Reload the page
      } catch (error) {
        console.error(error);
      }
    }

    function showAlert(message, options = {}) {
      ipcRenderer.callMain('dialog:message', {
        type: 'error',
        title: 'Alert',
        message,
        ...options,
      });
    }

    async function exportData() {
      try {
        const { canceled, filePaths } = await ipcRenderer.callMain(
          'dialog:open',
          {
            title: 'Export data',
            properties: ['openDirectory'],
          }
        );

        if (canceled) return;

        let data = await storage.store();
        data['default-path'] = defaultPath;
        data['lockedNotes'] = JSON.parse(localStorage.getItem('lockedNotes'));
        if (state.withPassword) {
          data = AES.encrypt(JSON.stringify(data), state.password).toString();
        }

        const folderName = dayjs().format('[Beaver Notes] YYYY-MM-DD');
        const folderPath = path.join(filePaths[0], folderName);
        const dataDir = await storage.get('dataDir', '', 'settings');

        await ipcRenderer.callMain('fs:ensureDir', folderPath);
        await ipcRenderer.callMain('fs:output-json', {
          path: path.join(folderPath, 'data.json'),
          data: { data },
        });
        await ipcRenderer.callMain('fs:copy', {
          path: path.join(dataDir, 'notes-assets'),
          dest: path.join(folderPath, 'assets'),
        });
        await ipcRenderer.callMain('fs:copy', {
          path: path.join(dataDir, 'file-assets'),
          dest: path.join(folderPath, 'file-assets'),
        });

        alert(`${translations.settings.exportmessage}"${folderName}"`);

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
        ];

        for (const { key, dfData } of keys) {
          const currentData = await storage.get(key, dfData);
          const importedData = data[key] ?? dfData;
          let mergedData;

          if (key === 'labels') {
            const mergedArr = [...currentData, ...importedData];

            mergedData = [...new Set(mergedArr)];
          } else {
            mergedData = { ...currentData, ...importedData };
          }

          await storage.set(key, mergedData);
        }
      } catch (error) {
        console.error(error);
      }
    }
    async function importData() {
      try {
        const {
          canceled,
          filePaths: [dirPath],
        } = await ipcRenderer.callMain('dialog:open', {
          title: 'Import data',
          properties: ['openDirectory'],
        });

        if (canceled) return;

        let { data } = await ipcRenderer.callMain(
          'fs:read-json',
          path.join(dirPath, 'data.json')
        );

        if (!data) return showAlert(translations.settings.invaliddata);

        if (typeof data === 'string') {
          dialog.prompt({
            title: translations.settings.Inputpassword,
            body: translations.settings.body,
            okText: translations.settings.Import,
            cancelText: translations.settings.Cancel,
            placeholder: translations.settings.Password,
            onConfirm: async (pass) => {
              try {
                const bytes = AES.decrypt(data, pass);
                const result = bytes.toString(Utf8);
                const resultObj = JSON.parse(result);

                await mergeImportedData(resultObj); // Wait for merge operation to finish
                const dataDir = await storage.get('dataDir', '', 'settings');
                const importedDefaultPath = data['dataDir'];
                const importedLockedStatus = data['lockStatus'];
                const importedLockedNotes = data['lockedNotes'];
                localStorage.setItem('dataDir', importedDefaultPath);
                if (
                  importedLockedStatus !== null &&
                  importedLockedStatus !== undefined
                ) {
                  localStorage.setItem(
                    'lockStatus',
                    JSON.stringify(importedLockedStatus)
                  );
                }

                if (
                  importedLockedNotes !== null &&
                  importedLockedNotes !== undefined
                ) {
                  localStorage.setItem(
                    'lockedNotes',
                    JSON.stringify(importedLockedNotes)
                  );
                }
                await ipcRenderer.callMain('fs:copy', {
                  path: path.join(dirPath, 'assets'),
                  dest: path.join(dataDir, 'notes-assets'),
                });
                await ipcRenderer.callMain('fs:copy', {
                  path: path.join(dirPath, 'file-assets'),
                  dest: path.join(dataDir, 'file-assets'),
                });

                console.log('Assets copied successfully.');
                window.location.reload();
              } catch (error) {
                showAlert(translations.settings.Invalidpassword);
                return false;
              }
            },
          });
        } else {
          await mergeImportedData(data); // Wait for merge operation to finish
          const dataDir = await storage.get('dataDir', '', 'settings');
          const importedDefaultPath = data['dataDir'];
          const importedLockedStatus = data['lockStatus'];
          const importedLockedNotes = data['lockedNotes'];
          localStorage.setItem('dataDir', importedDefaultPath);
          if (
            importedLockedStatus !== null &&
            importedLockedStatus !== undefined
          ) {
            localStorage.setItem(
              'lockStatus',
              JSON.stringify(importedLockedStatus)
            );
          }

          if (
            importedLockedNotes !== null &&
            importedLockedNotes !== undefined
          ) {
            localStorage.setItem(
              'lockedNotes',
              JSON.stringify(importedLockedNotes)
            );
          }
          await ipcRenderer.callMain('fs:copy', {
            path: path.join(dirPath, 'assets'),
            dest: path.join(dataDir, 'notes-assets'),
          });
          await ipcRenderer.callMain('fs:copy', {
            path: path.join(dirPath, 'file-assets'),
            dest: path.join(dataDir, 'file-assets'),
          });

          console.log('Assets copied successfully.');
          window.location.reload();
        }
      } catch (error) {
        console.error(error);
      }
    }

    async function chooseDefaultPath() {
      try {
        const {
          canceled,
          filePaths: [dir],
        } = await ipcRenderer.callMain('dialog:open', {
          title: 'Select directory',
          properties: ['openDirectory'],
        });

        if (canceled) return;
        defaultPath = dir;
        localStorage.setItem('default-path', defaultPath);
        state.dataDir = defaultPath;
        window.location.reload();
      } catch (error) {
        console.error(error);
      }
    }

    onMounted(() => {
      defaultPath = localStorage.getItem('default-path') || ''; // Set defaultPath here
      state.dataDir = defaultPath;
    });

    const shortcuts = {
      'mod+shift+u': importData,
      'mod+shift+e': exportData,
    };

    async function resetPasswordDialog() {
      const passwordStore = usePasswordStore(); // Get the password store instance

      dialog.prompt({
        title: translations.settings.resetPasswordTitle,
        okText: translations.settings.next,
        cancelText: translations.settings.Cancel,
        placeholder: translations.settings.password,
        onConfirm: async (currentPassword) => {
          if (currentPassword) {
            const isCurrentPasswordValid = await passwordStore.isValidPassword(
              currentPassword
            );
            if (isCurrentPasswordValid) {
              dialog.prompt({
                title: translations.settings.enterNewPassword,
                okText: translations.settings.resetPassword,
                body: translations.settings.warning,
                cancelText: translations.settings.Cancel,
                placeholder: translations.settings.newPassword,
                onConfirm: async (newPassword) => {
                  if (newPassword) {
                    try {
                      // Reset the password
                      await passwordStore.setsharedKey(newPassword);
                      console.log('Password reset successful');
                      alert(translations.settings.passwordResetSuccess);
                    } catch (error) {
                      console.error('Error resetting password:', error);
                      alert(translations.settings.passwordResetError);
                    }
                  } else {
                    alert(translations.settings.Invalidpassword);
                  }
                },
              });
            } else {
              alert(translations.settings.wrongCurrentPassword);
            }
          } else {
            alert(translations.settings.Invalidpassword);
          }
        },
      });
    }

    // Translations
    const translations = shallowReactive({
      settings: {
        advancedSettings: 'settings.advancedSettings',
        apptheme: 'settings.apptheme',
        light: 'settings.light',
        dark: 'settings.dark',
        system: 'settings.system',
        selectlanguage: 'settings.selectlanguage',
        selectfont: 'settings.selectfont',
        syncpath: 'settings.syncpath',
        selectpath: 'settings.selectpath',
        iedata: 'settings.iedata',
        encryptwpasswd: 'settings.encryptwpasswd',
        exportdata: 'settings.exportdata',
        importdata: 'settings.importdata',
        pathplaceholder: 'settings.pathplaceholder',
        password: 'settings.password',
        Inputpassword: 'settings.Inputpassword',
        body: 'settings.body',
        Import: 'settings.Import',
        Cancel: 'settings.Cancel',
        Password: 'settings.password',
        Invalidpassword: 'settings.Invalidpassword',
        relaunch: 'settings.relaunch',
        relaunchbutton: 'settings.relaunchbutton',
        exportmessage: 'settings.exportmessage',
        invaliddata: 'settings.invaliddata',
        syncreminder: 'settings.syncreminder',
        spellcheck: 'settings.spellcheck',
        fullWidth: 'settings.fullwidth',
        interfacesize: 'settings.interfacesize',
        large: 'settings.large',
        medium: 'settings.medium',
        default: 'settings.default',
        morespace: 'settings.morespace',
        aboutDataEncryption: 'settings.aboutDataEncryption',
        encryptionMessage: 'settings.encryptionMessage',
        resetPasswordTitle: 'settings.resetPasswordTitle',
        next: 'settings.next',
        enterNewPassword: 'settings.enterNewPassword',
        resetPassword: 'settings.resetPassword',
        newPassword: 'settings.newPassword',
        security: 'settings.security',
        utilities: 'settings.utilities',
        wrongCurrentPassword: 'settings.wrongCurrentPassword',
        passwordResetSuccess: 'settings.passwordResetSuccess',
        passwordResetError: 'settings.passwordResetError',
        menuBarVisibility: 'settings.menuBarVisibility',
        interfaceDirection: 'settings.interfaceDirection',
        LTR: 'settings.LTR',
        RTL: 'settings.RTL',
        autosync: 'settings.autosync',
        clearfont: 'settings.clearfont',
        platform: 'settings.platform',
        noAuthorizedApplicaitons: 'settings.noAuthorizedApplicaitons',
        id: 'settings.id',
        confirmDelete: 'settings.confirmDelete',
        createdAt: 'settings.createdAt',
        authorizedApplications: 'settings.authorizedApplications',
      },
    });

    onMounted(async () => {
      // Load translations
      const loadedTranslations = await loadTranslations();
      if (loadedTranslations) {
        Object.assign(translations, loadedTranslations);
      }
    });

    const loadTranslations = async () => {
      const selectedLanguage = localStorage.getItem('selectedLanguage') || 'en';
      try {
        const translationModule = await import(
          `../../pages/settings/locales/${selectedLanguage}.json`
        );
        return translationModule.default;
      } catch (error) {
        console.error('Error loading translations:', error);
        return null;
      }
    };

    Mousetrap.bind(Object.keys(shortcuts), (event, combo) => {
      shortcuts[combo]();
    });

    const appStore = useAppStore();
    appStore.updateFromStorage();
    const authorizatedApps = ref(
      appStore.authRecords.map((a) => a.status === 1)
    );

    watch(
      () => appStore.authRecords,
      (records) => {
        authorizatedApps.value = records.map((a) => a.status === 1);
      }
    );

    function deleteAuth(auth) {
      dialog.confirm({
        body: t(translations.settings.confirmDelete, {
          name: auth.name,
          id: auth.id,
        }),
        onConfirm: async () => {
          appStore.authRecords = appStore.authRecords.filter(
            (a) => a.id !== auth.id
          );
          await appStore.updateToStorage();
        },
      });
    }

    async function toggleAuth(auth, v) {
      auth.status = v ? 1 : 0;
      await appStore.updateToStorage();
    }

    return {
      state,
      theme,
      themes,
      storage,
      translations,
      exportData,
      importData,
      resetPasswordDialog,
      changeDataDir,
      chooseDefaultPath,
      defaultPath,
      appStore,
      formatTime,
      deleteAuth,
      toggleAuth,
      authorizatedApps,
      t,
    };
  },
  data() {
    return {
      advancedSettings: localStorage.getItem('advanced-settings') === 'true',
      directionPreference: localStorage.getItem('directionPreference') || 'ltr',
      spellcheckEnabled:
        localStorage.getItem('spellcheckEnabled') === 'true' &&
        localStorage.getItem('spellcheckEnabled') != null,
      disableAppReminder: localStorage.getItem('disableAppReminder') === 'true',
      autoSync: localStorage.getItem('autoSync') === 'true',
      selectedFont: localStorage.getItem('selected-font') || 'Arimo',
      selectedLanguage: localStorage.getItem('selectedLanguage') || 'en', // Initialize with a value from localStorage if available
      languages: [
        { code: 'de', name: 'Deutsch', translations: deTranslations },
        { code: 'en', name: 'English', translations: enTranslations },
        { code: 'es', name: 'Español', translations: esTranslations },
        { code: 'it', name: 'Italiano', translations: itTranslations },
        { code: 'nl', name: 'Nederlands', translations: nlTranslations },
        { code: 'zh', name: '简体中文', translations: zhTranslations },
        { code: 'uk', name: 'Українська', translations: ukTranslations },
      ],
    };
  },
  computed: {
    isMacOS() {
      return window.navigator.platform.toLowerCase().includes('mac');
    },
  },
};
</script>
