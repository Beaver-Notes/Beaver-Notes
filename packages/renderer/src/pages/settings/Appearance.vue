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
    <!-- Accent Color -->
    <section>
      <p class="mb-2">{{ translations.settings.colorScheme || '-' }}</p>
      <div class="w-full items-center justify-center flex gap-4">
        <button
          class="bg-red-500 p-2 w-10 h-10 rounded-full focus:ring-primary transition cursor-pointer"
          :class="{ 'ring-2 ring-primary': state.zoomLevel === '1.2' }"
          @click="setColor('red')"
        ></button>
        <button
          class="bg-amber-400 p-2 w-10 h-10 rounded-full focus:ring-primary transition cursor-pointer"
          :class="{ 'ring-2 ring-primary': state.zoomLevel === '1.2' }"
          @click="setColor('light')"
        ></button>
        <button
          class="bg-emerald-500 p-2 w-10 h-10 rounded-full focus:ring-primary transition cursor-pointer"
          :class="{ 'ring-2 ring-primary': state.zoomLevel === '1.2' }"
          @click="setColor('green')"
        ></button>
        <button
          class="bg-blue-400 p-2 w-10 h-10 rounded-full focus:ring-primary transition cursor-pointer"
          :class="{ 'ring-2 ring-primary': state.zoomLevel === '1.2' }"
          @click="setColor('blue')"
        ></button>
        <button
          class="bg-purple-400 p-2 w-10 h-10 rounded-full focus:ring-primary transition cursor-pointer"
          :class="{ 'ring-2 ring-primary': state.zoomLevel === '1.2' }"
          @click="setColor('purple')"
        ></button>
        <button
          class="bg-pink-400 p-2 w-10 h-10 rounded-full focus:ring-primary transition cursor-pointer"
          :class="{ 'ring-2 ring-primary': state.zoomLevel === '1.2' }"
          @click="setColor('pink')"
        ></button>
        <button
          class="bg-neutral-400 p-2 w-10 h-10 rounded-full focus:ring-primary transition cursor-pointer"
          :class="{ 'ring-2 ring-primary': state.zoomLevel === '1.2' }"
          @click="setColor('neutral')"
        ></button>
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
          :class="{ 'ring-2 ring-primary': state.zoomLevel === '0.9' }"
          @click="setZoom(0.9)"
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
    <!-- Font -->
    <section>
      <p class="mb-2">{{ translations.settings.selectfont || '-' }}</p>
      <div class="flex gap-2 items-center">
        <ui-select
          v-model="state.selectedFont"
          class="w-full"
          @change="updateFont"
        >
          <optgroup>
            <option
              v-for="font in defaultFonts"
              :key="font.value"
              :value="font.value"
              :class="font.class"
            >
              {{ font.label }}
            </option>
          </optgroup>
          <optgroup v-if="systemFonts.length">
            <option
              v-for="fontName in systemFonts"
              :key="fontName"
              :value="fontName"
              :style="{ fontFamily: fontName }"
            >
              {{ fontName }}
            </option>
          </optgroup>
        </ui-select>
      </div>
    </section>
    <!-- Code Font Section -->
    <section>
      <p class="mb-2">{{ translations.settings.selectcodefont || '-' }}</p>
      <div class="flex items-center gap-2">
        <ui-select
          id="codeFontSelect"
          v-model="state.selectedCodeFont"
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
      </div>
    </section>
    <!-- Interface Direction -->
    <section>
      <p class="mb-2">{{ translations.settings.interfaceDirection || '-' }}</p>
      <div class="grid grid-cols-2 gap-4">
        <ui-button
          class="bg-input p-2 rounded-lg focus:ring-primary transition cursor-pointer"
          :class="{
            'ring-2 ring-primary': state.directionPreference === 'ltr',
          }"
          @click="toggleLtr"
        >
          <p class="capitalize text-center text-sm">
            {{ translations.settings.LTR || '-' }}
          </p>
        </ui-button>
        <ui-button
          class="bg-input p-2 rounded-lg focus:ring-primary transition cursor-pointer"
          :class="{
            'ring-2 ring-primary': state.directionPreference === 'rtl',
          }"
          @click="toggleRtl"
        >
          <p class="capitalize text-center text-sm">
            {{ translations.settings.RTL || '-' }}
          </p>
        </ui-button>
      </div>
    </section>
    <!-- Page width -->
    <section>
      <p class="mb-2">
        {{ translations.settings.editorSpacing || '-' }}
      </p>
      <div class="grid grid-cols-3 gap-4">
        <!-- Normal Button -->
        <ui-button
          class="bg-input py-2 px-4 rounded-lg transition duration-200 hover:bg-gray-200"
          :class="{
            'outline-none ring-2 ring-primary': selectedWidth === '54rem',
          }"
          @click="setWidth('54rem')"
        >
          {{ translations.settings.normal || '-' }}
        </ui-button>
        <!-- Wide Button -->
        <ui-button
          class="bg-input py-2 px-4 rounded-lg transition duration-200 hover:bg-gray-200"
          :class="{
            'outline-none ring-2 ring-primary': selectedWidth === '68rem',
          }"
          @click="setWidth('68rem')"
        >
          {{ translations.settings.wide || '-' }}
        </ui-button>
        <!-- Custom Width (takes up the remaining space) -->
        <div class="relative col-span-1">
          <!-- Button (shown when not editing) -->
          <ui-button
            v-if="!isEditingCustomWidth"
            class="py-2 w-full px-4 rounded-lg bg-input transition duration-200 hover:bg-gray-200"
            :class="{
              'outline-none ring-2 ring-primary': selectedWidth === customWidth,
            }"
            @click="isEditingCustomWidth = true"
          >
            {{ customWidth }}
          </ui-button>
          <!-- Input (shown when editing) -->
          <div v-else class="relative">
            <input
              v-model="customWidthInput"
              type="text"
              class="w-full p-2 rounded-lg border text-center bg-input bg-transparent ring-2 ring-secondary"
              placeholder="translations.settings.enterWidth"
              style="appearance: none"
              @blur="applyCustomWidth"
              @keydown.enter="applyCustomWidth"
            />
            <span class="absolute top-2 right-2 text-gray-500">rem</span>
          </div>
        </div>
      </div>
    </section>
    <section>
      <p class="mb-2">{{ translations.settings.interfaceOptions || '-' }}</p>
      <div>
        <div class="space-y-1">
          <!-- Clear Text - OLED -->
          <div class="flex items-center py-2 justify-between">
            <div>
              <span class="block text-lg align-left">
                {{ translations.settings.clearfont || '-' }}
              </span>
            </div>
            <label class="relative inline-flex cursor-pointer items-center">
              <input
                id="switch"
                v-model="ClearFontChecked"
                type="checkbox"
                class="peer sr-only"
                @change="toggleClearFont"
              />
              <div
                class="peer h-6 w-11 rounded-full border bg-slate-200 dark:bg-[#353333] after:absolute after:left-[2px] rtl:after:right-[22px] after:top-0.5 after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-primary peer-checked:after:translate-x-full rtl:peer-checked:after:border-white peer-focus:ring-green-300"
              ></div>
            </label>
          </div>
          <!-- Menubar visibility -->
          <div v-if="!isMacOS" class="flex items-center py-2 justify-between">
            <div>
              <span class="block text-lg align-left">
                {{ translations.settings.menuBarVisibility || '-' }}
              </span>
            </div>
            <label class="relative inline-flex cursor-pointer items-center">
              <input
                id="switch"
                v-model="visibilityMenubar"
                type="checkbox"
                class="peer sr-only"
                @change="toggleVisibilityOfMenubar"
              />
              <div
                class="peer h-6 w-11 rounded-full border bg-slate-200 dark:bg-[#353333] after:absolute after:left-[2px] rtl:after:right-[22px] after:top-0.5 after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-primary peer-checked:after:translate-x-full rtl:peer-checked:after:border-white peer-focus:ring-green-300"
              ></div>
            </label>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script>
import { shallowReactive, onMounted, computed, ref } from 'vue';
import { useTheme } from '@/composable/theme';
import { useStorage } from '@/composable/storage';
import lightImg from '@/assets/images/light.png';
import darkImg from '@/assets/images/dark.png';
import systemImg from '@/assets/images/system.png';
import '../../assets/css/passwd.css';
import LTRImg from '@/assets/images/LTR.png';
import LTRImgDark from '@/assets/images/LTR-dark.png';
import RTLImg from '@/assets/images/RTL.png';
import RTLImgDark from '@/assets/images/RTL-dark.png';

export default {
  setup() {
    const themes = [
      { name: 'light', img: lightImg },
      { name: 'dark', img: darkImg },
      { name: 'system', img: systemImg },
    ];

    const theme = useTheme();
    const storage = useStorage();

    // State for application settings
    const state = shallowReactive({
      dataDir: '',
      password: '',
      withPassword: false,
      lastUpdated: null,
      zoomLevel: (+localStorage.getItem('zoomLevel') || 1).toFixed(1),
      directionPreference: localStorage.getItem('directionPreference') || 'ltr',
      selectedFont: localStorage.getItem('selected-font') || 'Arimo',
      selectedCodeFont:
        localStorage.getItem('selected-font-code') || 'JetBrains Mono',
    });

    let defaultPath = '';

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

    // Computed properties
    const isMacOS = computed(() =>
      window.navigator.platform.toLowerCase().includes('mac')
    );

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

    const setColor = (color) => {
      const root = document.documentElement;
      root.classList.forEach((cls) => {
        if (cls !== 'light' && cls !== 'dark') {
          root.classList.remove(cls);
        }
      });
      root.classList.add(color);
      localStorage.setItem('color-scheme', color);
    };

    const visibilityMenubar = computed({
      get: () => localStorage.getItem('visibility-menubar') === 'true',
      set: (val) => {
        localStorage.setItem('visibility-menubar', val.toString());
      },
    });

    const defaultFonts = [
      { label: 'Arimo', value: 'Arimo', class: 'font-arimo' },
      { label: 'Avenir', value: 'avenir', class: 'font-avenir' },
      { label: 'EB Garamond', value: 'EB Garamond', class: 'font-eb-faramond' },
      {
        label: 'Helvetica',
        value: "'Helvetica Neue', sans-serif",
        class: 'font-helvetica',
      },
      {
        label: 'Open Dyslexic',
        value: 'OpenDyslexic',
        class: 'font-open-dyslexic',
      },
      { label: 'Roboto Mono', value: 'Roboto Mono', class: 'font-roboto-mono' },
      { label: 'Ubuntu', value: 'Ubuntu', class: 'font-ubuntu' },
    ];

    const systemFonts = ref([]);

    onMounted(async () => {
      try {
        systemFonts.value = await window.electron.ipcRenderer.callMain(
          'get-system-fonts'
        );
      } catch (e) {
        console.error('Failed to fetch system fonts', e);
      }
    });

    // Reactive variables for width management
    const selectedWidth = ref(localStorage.getItem('editorWidth') || '54rem');
    const customWidth = ref(
      localStorage.getItem('customEditorWidth') || '60rem'
    );
    const customWidthInput = ref(customWidth.value.replace('rem', ''));
    const isEditingCustomWidth = ref(false);

    // Lifecycle hooks and initialization
    onMounted(() => {
      defaultPath = localStorage.getItem('default-path') || '';
      state.dataDir = defaultPath;

      // Set font and direction properties
      document.documentElement.style.setProperty(
        '--selected-font',
        state.selectedFont
      );
      document.documentElement.style.setProperty(
        '--selected-font-code',
        state.selectedCodeFont
      );
      document.documentElement.dir = state.directionPreference;
    });

    // Translation loading
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

    onMounted(async () => {
      const loadedTranslations = await loadTranslations();
      if (loadedTranslations) {
        Object.assign(translations, loadedTranslations);
      }
    });

    // Methods
    const toggleClearFont = () => {
      ClearFontChecked.value = !ClearFontChecked.value;
    };

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

    const toggleDirectionPreference = () => {
      state.directionPreference =
        state.directionPreference === 'rtl' ? 'ltr' : 'rtl';
      localStorage.setItem('directionPreference', state.directionPreference);
      document.documentElement.dir = state.directionPreference;
    };

    const updateFont = () => {
      localStorage.setItem('selected-font', state.selectedFont);
      document.documentElement.style.setProperty(
        '--selected-font',
        state.selectedFont
      );
    };

    const updateCodeFont = () => {
      localStorage.setItem('selected-font-code', state.selectedCodeFont);
      document.documentElement.style.setProperty(
        '--selected-font-code',
        state.selectedCodeFont
      );
    };

    const setZoom = (newZoomLevel) => {
      console.log('Setting zoom level to:', newZoomLevel);
      window.electron.ipcRenderer.callMain('app:set-zoom', newZoomLevel);
      state.zoomLevel = newZoomLevel.toFixed(1);
      localStorage.setItem('zoomLevel', state.zoomLevel);
      window.location.reload();
    };

    // Width management methods
    const setWidth = (width) => {
      selectedWidth.value = width;
      localStorage.setItem('editorWidth', width);
      document.documentElement.style.setProperty('--selected-width', width);
    };

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
      isMacOS,
      toggleDirectionPreference,
      updateFont,
      updateCodeFont,
      setZoom,
      setColor,
      defaultFonts,
      systemFonts,
    };
  },
};
</script>
