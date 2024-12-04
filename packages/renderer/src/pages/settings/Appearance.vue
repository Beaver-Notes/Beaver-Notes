<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="general space-y-8 mb-14 w-full max-w-xl">
    <!-- App theme -->
    <section>
      <p class="mb-2">{{ translations.settings.apptheme || '-' }}</p>
      <div
        class="flex ltr:space-x-4 text-gray-600 dark:text-[color:var(--selected-dark-text)]"
      >
        <button
          v-for="item in themes"
          :key="item.name"
          :class="{
            'ring-2 ring-primary': theme.currentTheme.value === item.name,
          }"
          class="bg-input p-2 rtl:mx-2 rounded-lg transition cursor-pointer"
          @click="theme.setTheme(item.name)"
        >
          <img :src="item.img" class="w-40 border-2 mb-1 rounded-lg" />
          <p class="capitalize text-center text-sm">
            {{ translations.settings[item.name] || item.name }}
          </p>
        </button>
      </div>
    </section>
    <!-- Interface size -->
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
    <!-- Interface Direction -->
    <section>
      <p class="mb-2">{{ translations.settings.interfaceDirection || '-' }}</p>
      <div class="grid grid-cols-2 gap-4">
        <button
          class="bg-input p-2 rounded-lg focus:ring-primary transition cursor-pointer"
          :class="{ 'ring-2 ring-primary': directionPreference === 'ltr' }"
          @click="toggleLtr"
        >
          <img
            :src="theme.currentTheme.value === 'dark' ? LTRImgDark : LTRImg"
            class="w-full mx-auto mb-1 rounded-lg"
          />
          <p class="capitalize text-center text-sm">
            {{ translations.settings.LTR || '-' }}
          </p>
        </button>
        <button
          class="bg-input p-2 rounded-lg focus:ring-primary transition cursor-pointer"
          :class="{ 'ring-2 ring-primary': directionPreference === 'rtl' }"
          @click="toggleRtl"
        >
          <img
            :src="theme.currentTheme.value === 'dark' ? RTLImgDark : RTLImg"
            class="w-full mx-auto mb-1 rounded-lg"
          />

          <p class="capitalize text-center text-sm">
            {{ translations.settings.RTL || '-' }}
          </p>
        </button>
      </div>
    </section>
    <!-- Page width -->
    <section>
      <p class="mb-2 text-gray-700">
        {{ translations.settings.editorSpacing || '-' }}
      </p>
      <div class="grid grid-cols-3 gap-4">
        <!-- Normal Button -->
        <button
          class="bg-input py-2 px-4 rounded-lg transition duration-200 hover:bg-gray-200"
          :class="{
            'outline-none ring-2 ring-primary': selectedWidth === '54rem',
          }"
          @click="setWidth('54rem')"
        >
          {{ translations.settings.normal || '-' }}
        </button>
        <!-- Wide Button -->
        <button
          class="bg-input py-2 px-4 rounded-lg transition duration-200 hover:bg-gray-200"
          :class="{
            'outline-none ring-2 ring-primary': selectedWidth === '68rem',
          }"
          @click="setWidth('68rem')"
        >
          {{ translations.settings.wide || '-' }}
        </button>
        <!-- Custom Width (takes up the remaining space) -->
        <div class="relative col-span-1">
          <!-- Button (shown when not editing) -->
          <button
            v-if="!isEditingCustomWidth"
            class="py-2 w-full px-4 rounded-lg bg-input transition duration-200 hover:bg-gray-200"
            :class="{
              'outline-none ring-2 ring-primary': selectedWidth === customWidth,
            }"
            @click="isEditingCustomWidth = true"
          >
            {{ customWidth }}
          </button>
          <!-- Input (shown when editing) -->
          <div v-else class="relative">
            <input
              v-model="customWidthInput"
              type="text"
              class="w-full p-2 rounded-lg border text-center"
              placeholder="translations.settings.enterWidth"
              @blur="applyCustomWidth"
              @keydown.enter="applyCustomWidth"
              style="appearance: none"
            />
            <span class="absolute top-2 right-2 text-gray-500">rem</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Font -->
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
        <option value="Roboto Mono" class="font-roboto-mono">
          Roboto Mono
        </option>
        <option value="Ubuntu" class="font-ubuntu">Ubuntu</option>
      </ui-select>
    </section>
    <!-- Code Font -->
    <section>
      <p class="mb-2">{{ translations.settings.selectcodefont || '-' }}</p>
      <ui-select
        id="codeFontSelect"
        v-model="selectedCodeFont"
        class="w-full"
        @change="updateCodeFont"
      >
        <option value="Anonymous Pro" class="anonymous-pro">
          Anonymous Pro
        </option>
        <option value="Hack" class="font-hack">Hack</option>
        <option value="JetBrains Mono" class="font-JetBrainsMono">
          JetBrains Mono
        </option>
        <option value="Source Code Pro" class="font-source-code-pro">
          Source Code Pro
        </option>
      </ui-select>
    </section>
  </div>
</template>

<script>
import { shallowReactive, onMounted, computed, ref } from 'vue';
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
import LTRImg from '@/assets/images/LTR.png';
import LTRImgDark from '@/assets/images/LTR-dark.png';
import RTLImg from '@/assets/images/RTL.png';
import RTLImgDark from '@/assets/images/RTL-dark.png';

const deTranslations = import('../../pages/settings/locales/de.json');
const enTranslations = import('../../pages/settings/locales/en.json');
const esTranslations = import('../../pages/settings/locales/es.json');
const itTranslations = import('../../pages/settings/locales/it.json');
const nlTranslations = import('../../pages/settings/locales/nl.json');
const zhTranslations = import('../../pages/settings/locales/zh.json');

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
        editorSpacing: 'settings.editorSpacing',
        normal: 'settings.normal',
        wide: 'settings.wide',
        enterWidth: 'settings.enterwidth',
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
        selectcodefont: 'settings.selectcodefont',
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

    const ClearFontChecked = computed({
      get: () => localStorage.getItem('selected-dark-text') === '#CCCCCC',
      set: (value) => {
        localStorage.setItem('selected-dark-text', value ? '#CCCCCC' : 'white');
        document.documentElement.style.setProperty(
          'selected-dark-text',
          value ? '#CCCCCC' : 'white'
        );
        window.location.reload();
      },
    });

    const toggleClearFont = () => {
      ClearFontChecked.value = !ClearFontChecked.value;
    };

    const visibilityMenubar = computed({
      get: () => localStorage.getItem('visibility-menubar') === 'true',
      set: (val) => {
        localStorage.setItem('visibility-menubar', val.toString());
      },
    });
    const toggleVisibilityOfMenubar = async () => {
      await window.electron.ipcRenderer.callMain(
        'app:change-menu-visibility',
        localStorage.getItem('visibility-menubar') !== 'true'
      );
    };
    const toggleRtl = () => {
      localStorage.setItem('directionPreference', 'rtl');
      window.location.reload();
    };

    const toggleLtr = () => {
      localStorage.setItem('directionPreference', 'ltr');
      window.location.reload();
    };

    // Reactive variables for width management
    const selectedWidth = ref(localStorage.getItem('editorWidth') || '54rem');
    const customWidth = ref(
      localStorage.getItem('customEditorWidth') || '60rem'
    );
    const customWidthInput = ref(customWidth.value.replace('rem', ''));
    const isEditingCustomWidth = ref(false);

    // Set selected width
    const setWidth = (width) => {
      selectedWidth.value = width;
      localStorage.setItem('editorWidth', width);
      document.documentElement.style.setProperty('--selected-width', width);
    };

    // Apply custom width when user finishes input
    const applyCustomWidth = () => {
      if (customWidthInput.value) {
        customWidth.value = `${customWidthInput.value}rem`;
        selectedWidth.value = customWidth.value;
        localStorage.setItem('customEditorWidth', customWidth.value);
        localStorage.setItem('editorWidth', customWidth.value);
        document.documentElement.style.setProperty(
          '--selected-width',
          customWidth.value
        );
      }
      isEditingCustomWidth.value = false;
    };
    return {
      state,
      theme,
      themes,
      storage,
      translations,
      toggleRtl,
      toggleLtr,
      toggleClearFont,
      ClearFontChecked,
      visibilityMenubar,
      toggleVisibilityOfMenubar,
      selectedWidth,
      customWidth,
      customWidthInput,
      isEditingCustomWidth,
      setWidth,
      applyCustomWidth,
      LTRImg,
      LTRImgDark,
      RTLImg,
      RTLImgDark,
    };
  },
  data() {
    return {
      directionPreference: localStorage.getItem('directionPreference') || 'ltr',
      selectedFont: localStorage.getItem('selected-font') || 'Arimo',
      selectedCodeFont:
        localStorage.getItem('selected-font-code') || 'JetBrains Mono',
      selectedLanguage: localStorage.getItem('selectedLanguage') || 'en', // Initialize with a value from localStorage if available
      languages: [
        { code: 'de', name: 'Deutsch', translations: deTranslations },
        { code: 'en', name: 'English', translations: enTranslations },
        { code: 'es', name: 'Español', translations: esTranslations },
        { code: 'it', name: 'Italiano', translations: itTranslations },
        { code: 'nl', name: 'Nederlands', translations: nlTranslations },
        { code: 'zh', name: '简体中文', translations: zhTranslations },
      ],
    };
  },
  computed: {
    isMacOS() {
      return window.navigator.platform.toLowerCase().includes('mac');
    },
  },
  mounted() {
    document.documentElement.style.setProperty(
      '--selected-font',
      this.selectedFont
    );
  },
  methods: {
    async loadTranslations() {
      const loadedTranslations = await this.fetchTranslations();
      if (loadedTranslations) {
        Object.assign(this.translations, loadedTranslations);
      }
    },
    async fetchTranslations() {
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
    },
    toggledirectionPreference() {
      this.directionPreference =
        this.directionPreference === 'rtl' ? 'ltr' : 'rtl';
      localStorage.setItem('directionPreference', this.directionPreference);
      document.documentElement.dir = this.directionPreference;
    },
    updateFont() {
      localStorage.setItem('selected-font', this.selectedFont);
      document.documentElement.style.setProperty(
        '--selected-font',
        this.selectedFont
      );
    },
    updateCodeFont() {
      localStorage.setItem('selected-font-code', this.selectedCodeFont);
      document.documentElement.style.setProperty(
        '--selected-font-code',
        this.selectedCodeFont
      );
    },
    setZoom(newZoomLevel) {
      window.electron.ipcRenderer.callMain('app:set-zoom', newZoomLevel);
      this.state.zoomLevel = newZoomLevel.toFixed(1);
      localStorage.setItem('zoomLevel', this.state.zoomLevel);
    },
  },
};
</script>
