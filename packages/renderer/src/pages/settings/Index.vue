<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="general space-y-8 mb-14 w-full max-w-xl">
    <section>
      <div>
        <p class="mb-2">{{ translations.settings.selectlanguage || '-' }}</p>
        <ui-select
          v-model="selectedLanguage"
          class="w-full"
          @change="updateLanguage"
        >
          <option
            v-for="language in languages"
            :key="language.code"
            :value="language.code"
          >
            {{ language.name }}
          </option>
        </ui-select>
      </div>
    </section>
    <section>
      <p class="mb-2">{{ translations.settings.syncpath || '-' }}</p>
      <div class="flex items-center ltr:space-x-2">
        <ui-input
          v-model="state.dataDir"
          readonly
          :placeholder="translations.settings.pathplaceholder || '-'"
          class="w-full"
          @click="chooseDefaultPath"
        />
        <ui-button class="w-full rtl:mx-2" @click="chooseDefaultPath">
          {{ translations.settings.selectpath || '-' }}
        </ui-button>
      </div>
    </section>
    <section>
      <p class="mb-2">{{ translations.settings.utilities || '-' }}</p>
      <div className="bg-[#F2F2F2] dark:bg-[#2D2D2D] px-2 rounded-xl">
        <div class="space-y-1">
          <!-- advanced settings -->
          <div class="flex items-center border-b-2 py-2 justify-between">
            <div>
              <span class="block text-lg align-left">
                {{ translations.settings.advancedSettings || '-' }}
              </span>
            </div>
            <label class="relative inline-flex cursor-pointer items-center">
              <input
                id="switch"
                v-model="advancedSettings"
                type="checkbox"
                class="peer sr-only"
                @change="toggleAdvancedSettings"
              />
              <div
                class="peer h-6 w-11 rounded-full border bg-slate-200 dark:bg-[#353333] after:absolute after:left-[2px] rtl:after:right-[22px] after:top-0.5 after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-amber-400 peer-checked:after:translate-x-full rtl:peer-checked:after:border-white peer-focus:ring-green-300"
              ></div>
            </label>
          </div>
          <!-- App Reminder -->
          <div class="flex items-center border-b-2 py-2 justify-between">
            <div>
              <span class="block text-lg align-left">
                {{ translations.settings.syncreminder || '-' }}
              </span>
            </div>
            <label class="relative inline-flex cursor-pointer items-center">
              <input
                id="switch"
                v-model="disableAppReminder"
                type="checkbox"
                class="peer sr-only"
                @change="updateDisableAppReminder"
              />
              <div
                class="peer h-6 w-11 rounded-full border bg-slate-200 dark:bg-[#353333] after:absolute after:left-[2px] rtl:after:right-[22px] after:top-0.5 after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-amber-400 peer-checked:after:translate-x-full rtl:peer-checked:after:border-white peer-focus:ring-green-300"
              ></div>
            </label>
          </div>
          <!-- Spellcheck -->
          <div class="flex items-center border-b-2 py-2 justify-between">
            <div>
              <span class="block text-lg align-left">
                {{ translations.settings.spellcheck || '-' }}
              </span>
            </div>
            <label class="relative inline-flex cursor-pointer items-center">
              <input
                id="switch"
                v-model="spellcheckEnabled"
                type="checkbox"
                class="peer sr-only"
                @change="toggleSpellcheck"
              />
              <div
                class="peer h-6 w-11 rounded-full border bg-slate-200 dark:bg-[#353333] after:absolute after:left-[2px] rtl:after:right-[22px] after:top-0.5 after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-amber-400 peer-checked:after:translate-x-full rtl:peer-checked:after:border-white peer-focus:ring-green-300"
              ></div>
            </label>
          </div>
          <!-- Auto Sync -->
          <div class="flex items-center py-2 justify-between">
            <div>
              <span class="block text-lg align-left">
                {{ translations.settings.autosync || '-' }}
              </span>
            </div>
            <label class="relative inline-flex cursor-pointer items-center">
              <input
                id="switch"
                v-model="autoSync"
                type="checkbox"
                class="peer sr-only"
                @change="updateAutoSync"
              />
              <div
                class="peer h-6 w-11 rounded-full border bg-slate-200 dark:bg-[#353333] after:absolute after:left-[2px] rtl:after:right-[22px] after:top-0.5 after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-amber-400 peer-checked:after:translate-x-full rtl:peer-checked:after:border-white peer-focus:ring-green-300"
              ></div>
            </label>
          </div>
        </div>
      </div>
    </section>
    <section>
      <p class="mb-2">{{ translations.settings.iedata || '-' }}</p>
      <div class="flex ltr:space-x-4">
        <div class="bg-input rtl:ml-4 transition w-6/12 rounded-lg p-4">
          <div class="text-center mb-8 dark:text-gray-300 text-gray-600">
            <span
              class="p-5 rounded-full bg-black dark:bg-white dark:bg-opacity-5 bg-opacity-5 inline-block"
            >
              <v-remixicon size="36" name="riFileUploadLine" />
            </span>
          </div>
          <ui-checkbox v-model="state.withPassword">
            {{ translations.settings.encryptwpasswd || '-' }}
          </ui-checkbox>
          <expand-transition>
            <ui-input
              v-if="state.withPassword"
              v-model="state.password"
              :placeholder="translations.settings.password || '-'"
              class="mt-2 w-fill"
              style="-webkit-text-security: disc"
              autofocus
              @keyup.enter="exportData"
            />
          </expand-transition>
          <ui-button class="w-full mt-4" @click="exportData(defaultPath)">
            {{ translations.settings.exportdata || '-' }}</ui-button
          >
        </div>
        <div class="bg-input transition w-6/12 rounded-lg p-4 flex flex-col">
          <div class="text-center mb-6 dark:text-gray-300 text-gray-600">
            <span
              class="p-5 rounded-full bg-black dark:bg-white dark:bg-opacity-5 bg-opacity-5 inline-block"
            >
              <v-remixicon size="36" name="riFileDownloadLine" />
            </span>
          </div>
          <div class="flex-grow"></div>
          <ui-button class="w-full mt-6" @click="importData(defaultPath)">
            {{ translations.settings.importdata || '-' }}
          </ui-button>
        </div>
      </div>
      <div class="flex items-center">
        <v-remixicon
          name="riQuestionLine"
          class="inline-block align-middle mr-1 mt-2"
        />
        <p class="text-sm relative text-gray-500 mt-2">
          <span v-tooltip:right="translations.settings.encryptionMessage">
            {{ translations.settings.aboutDataEncryption || '-' }}
          </span>
        </p>
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
  methods: {
    toggleAdvancedSettings() {
      localStorage.setItem(
        'advanced-settings',
        this.advancedSettings.toString()
      );
    },
    toggleSpellcheck() {
      localStorage.setItem('spellcheckEnabled', this.spellcheckEnabled);
      this.applySpellcheckAttribute();
    },
    applySpellcheckAttribute() {
      const inputElements = document.querySelectorAll(
        'input, textarea, [contenteditable="true"]'
      );
      inputElements.forEach((element) => {
        element.setAttribute('spellcheck', this.spellcheckEnabled);
        window.electron.ipcRenderer.callMain(
          'app:spellcheck',
          this.spellcheckEnabled
        );
      });
    },
    updateLanguage() {
      const languageCode = this.selectedLanguage;
      localStorage.setItem('selectedLanguage', languageCode);
      window.location.reload(); // Reload the page
    },
    updateDisableAppReminder() {
      localStorage.setItem(
        'disableAppReminder',
        this.disableAppReminder.toString()
      );
    },
    updateAutoSync() {
      localStorage.setItem('autoSync', this.autoSync.toString());
    },
  },
};
</script>
