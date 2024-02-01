<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="general space-y-8 w-full max-w-xl">
    <section>
      <p class="mb-2">{{ translations.settings.apptheme || '-' }}</p>
      <div class="flex space-x-4 text-gray-600 dark:text-gray-200">
        <button
          v-for="item in themes"
          :key="item.name"
          :class="{
            'ring-2 ring-primary': theme.currentTheme.value === item.name,
          }"
          class="bg-input p-2 rounded-lg transition cursor-pointer"
          @click="theme.setTheme(item.name)"
        >
          <img :src="item.img" class="w-40 border-2 mb-1 rounded-lg" />
          <p class="capitalize text-center text-sm">
            {{ translations.settings[item.name] || item.name }}
          </p>
        </button>
      </div>
    </section>
    <section>
      <p class="mb-2">{{ translations.settings.interfacesize || '-' }}</p>
      <div class="grid grid-cols-4 gap-4">
        <button
          class="bg-input p-2 rounded-lg focus:ring-primary transition cursor-pointer"
          :class="{ 'ring-2 ring-primary': state.zoomLevel === '1.2' }"
          @click="setZoom(1.2)"
        >
          <img
            src="/src/assets/images/Large.png"
            class="w-40 border-2 mb-1 rounded-lg"
          />
          <p class="capitalize text-center text-sm">
            {{ translations.settings.large || '-' }}
          </p>
        </button>
        <button
          class="bg-input p-2 rounded-lg focus:ring-primary transition cursor-pointer"
          :class="{ 'ring-2 ring-primary': state.zoomLevel === '1.1' }"
          @click="setZoom(1.1)"
        >
          <img
            src="/src/assets/images/Medium.png"
            class="w-40 border-2 mb-1 rounded-lg"
          />
          <p class="capitalize text-center text-sm">
            {{ translations.settings.medium || '-' }}
          </p>
        </button>
        <button
          class="bg-input p-2 rounded-lg focus:ring-primary transition cursor-pointer"
          :class="{ 'ring-2 ring-primary': state.zoomLevel === '1.0' }"
          @click="setZoom(1.0)"
        >
          <img
            src="/src/assets/images/Default.png"
            class="w-40 border-2 mb-1 rounded-lg"
          />
          <p class="capitalize text-center text-sm">
            {{ translations.settings.default || '-' }}
          </p>
        </button>
        <button
          class="bg-input p-2 rounded-lg focus:ring-primary transition cursor-pointer"
          :class="{ 'ring-2 ring-primary': state.zoomLevel === '0.8' }"
          @click="setZoom(0.8)"
        >
          <img
            src="/src/assets/images/More Space.png"
            class="w-40 border-2 mb-1 rounded-lg"
          />
          <p class="capitalize text-center text-sm">
            {{ translations.settings.morespace || '-' }}
          </p>
        </button>
      </div>
    </section>
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
      <p class="mb-2">{{ translations.settings.selectfont || '-' }}</p>
      <ui-select
        id="fontSelect"
        v-model="selectedFont"
        class="w-full"
        @change="updateFont"
      >
        <option value="Arimo" class="font-arimo">Arimo</option>
        <option value="avenir" class="font-avenir">Avenir</option>
        <option value="EB Garamond" class="font-eb-faramond">
          EB Garamond
        </option>
        <option value="'Helvetica Neue', sans-serif" class="font-helvetica">
          Helvetica
        </option>
        <option value="OpenDyslexic" class="font-open-dyslexic">
          Open Dyslexic
        </option>
        <option value="Ubuntu" class="font-ubuntu">Ubuntu</option>
      </ui-select>
    </section>
    <section>
      <p class="mb-2">{{ translations.settings.syncpath || '-' }}</p>
      <div class="flex items-center space-x-2">
        <ui-input
          v-model="state.dataDir"
          readonly
          :placeholder="translations.settings.pathplaceholder || '-'"
          class="w-full"
          @click="chooseDefaultPath"
        />
        <ui-button class="w-full" @click="chooseDefaultPath">
          {{ translations.settings.selectpath || '-' }}
        </ui-button>
      </div>
    </section>
    <section>
      <label class="flex items-center space-x-2">
        <input
          v-model="disableAppReminder"
          class="form-checkbox"
          type="checkbox"
          @change="updateDisableAppReminder"
        />
        <span class="inline-block align-middle">
          {{ translations.settings.syncreminder || '-' }}
        </span>
      </label>
    </section>
    <section>
      <label>
        <input
          v-model="spellcheckEnabled"
          type="checkbox"
          @change="toggleSpellcheck"
        />
        <span class="inline-block ml-2 align-middle">
          {{ translations.settings.spellcheck || '-' }}
        </span>
      </label>
    </section>
    <section>
      <label class="flex items-center space-x-2">
        <input
          v-model="advancedSettings"
          class="form-checkbox"
          type="checkbox"
          @change="toggleAdvancedSettings"
        />
        <span class="inline-block align-middle">
          {{ translations.settings.advancedSettings || '-' }}
        </span>
      </label>
    </section>
    <section>
      <p class="mb-2">{{ translations.settings.iedata || '-' }}</p>
      <div class="flex space-x-4">
        <div class="bg-input transition w-6/12 rounded-lg p-4">
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
              class="mt-2"
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
import { shallowReactive, onMounted } from 'vue';
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
import '../../assets/css/passwd.css';
const enTranslations = import('../../pages/settings/locales/en.json');
const itTranslations = import('../../pages/settings/locales/it.json');
const deTranslations = import('../../pages/settings/locales/de.json');
const zhTranslations = import('../../pages/settings/locales/zh.json');

export const state = shallowReactive({
  dataDir: '',
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

        window.location.reload();
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
            onConfirm: (pass) => {
              try {
                const bytes = AES.decrypt(data, pass);
                const result = bytes.toString(Utf8);
                const resultObj = JSON.parse(result);

                mergeImportedData(resultObj);
              } catch (error) {
                showAlert(translations.settings.Invalidpassword);
                return false;
              }
            },
          });
        } else {
          mergeImportedData(data);
        }

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

        if (importedLockedNotes !== null && importedLockedNotes !== undefined) {
          localStorage.setItem(
            'lockedNotes',
            JSON.stringify(importedLockedNotes)
          );
        }

        await ipcRenderer.callMain('fs:copy', {
          // eslint-disable-next-line no-undef
          path: path.join(folderPath, 'assets'),
          dest: path.join(dataDir, 'notes-assets'),
        });
        window.reload();
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

        showAlert(translations.settings.relaunch, {
          type: 'info',
          buttons: [translations.settings.relaunchbutton],
        });
        defaultPath = dir;
        localStorage.setItem('default-path', defaultPath);
        state.dataDir = defaultPath;
        window.location.reload(); // Reload the page
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
        interfacesize: 'settings.interfacesize',
        large: 'settings.large',
        medium: 'settings.medium',
        default: 'settings.default',
        morespace: 'settings.morespace',
        aboutDataEncryption: 'settings.aboutDataEncryption',
        encryptionMessage: 'settings.encryptionMessage',
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

    return {
      state,
      theme,
      themes,
      storage,
      translations,
      exportData,
      importData,
      changeDataDir,
      chooseDefaultPath,
      defaultPath,
    };
  },
  data() {
    return {
      advancedSettings: localStorage.getItem('advanced-settings') === 'true',
      spellcheckEnabled:
        localStorage.getItem('spellcheckEnabled') === 'true' &&
        localStorage.getItem('spellcheckEnabled') != null,
      disableAppReminder: localStorage.getItem('disableAppReminder') === 'true',
      selectedFont: localStorage.getItem('selected-font') || 'Arimo',
      selectedLanguage: localStorage.getItem('selectedLanguage') || 'en', // Initialize with a value from localStorage if available
      languages: [
        { code: 'en', name: 'English', translations: enTranslations },
        { code: 'it', name: 'Italiano', translations: itTranslations },
        { code: 'de', name: 'Deutsch', translations: deTranslations },
        { code: 'zh', name: '简体中文', translations: zhTranslations },
      ],
    };
  },
  mounted() {
    document.documentElement.style.setProperty(
      '--selected-font',
      this.selectedFont
    );
  },
  methods: {
    toggleAdvancedSettings() {
      localStorage.setItem(
        'advanced-settings',
        this.advancedSettings.toString()
      );
    },
    updateFont() {
      localStorage.setItem('selected-font', this.selectedFont);

      document.documentElement.style.setProperty(
        '--selected-font',
        this.selectedFont
      );
    },
    setZoom(newZoomLevel) {
      window.electron.ipcRenderer.callMain('app:set-zoom', newZoomLevel);
      this.state.zoomLevel = newZoomLevel.toFixed(1);
      localStorage.setItem('zoomLevel', this.state.zoomLevel);
    },
    toggleSpellcheck() {
      // Update localStorage and apply spellcheck attribute to input elements
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
  },
};
</script>
