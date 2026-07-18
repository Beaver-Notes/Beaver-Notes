<template>
  <div class="general space-y-8 mb-14 w-full max-w-xl">
    <!-- App theme -->
    <section>
      <p class="mb-2">{{ translations.appearance.appTheme || '-' }}</p>
      <div
        class="flex ltr:space-x-4 text-neutral-600 dark:text-[color:var(--selected-dark-text)]"
      >
        <button
          v-for="item in themes"
          :key="item.name"
          :class="{
            'ring-1 ring-primary': theme.currentTheme.value === item.name,
          }"
          class="bg-input p-2 rtl:mx-2 rounded-lg transition"
          @click="theme.setTheme(item.name)"
        >
          <img :src="item.img" class="w-40 border-2 mb-1 rounded-lg" />
          <p class="capitalize text-center text-sm">
            {{ translations.appearance[item.name] || item.name }}
          </p>
        </button>
      </div>
    </section>
    <!-- Accent Color -->
    <section>
      <p class="mb-2">{{ translations.appearance.colorScheme || '-' }}</p>
      <div class="w-full items-center justify-center flex gap-4">
        <button
          class="bg-red-500 p-2 w-10 h-10 rounded-full focus:ring-primary transition"
          :class="{ 'ring-1 ring-primary': state.accentColor === 'red' }"
          @click="setColor('red')"
        ></button>
        <button
          class="bg-amber-400 p-2 w-10 h-10 rounded-full focus:ring-primary transition"
          :class="{ 'ring-1 ring-primary': state.accentColor === 'light' }"
          @click="setColor('light')"
        ></button>
        <button
          class="bg-emerald-500 p-2 w-10 h-10 rounded-full focus:ring-primary transition"
          :class="{ 'ring-1 ring-primary': state.accentColor === 'green' }"
          @click="setColor('green')"
        ></button>
        <button
          class="bg-blue-400 p-2 w-10 h-10 rounded-full focus:ring-primary transition"
          :class="{ 'ring-1 ring-primary': state.accentColor === 'blue' }"
          @click="setColor('blue')"
        ></button>
        <button
          class="bg-purple-400 p-2 w-10 h-10 rounded-full focus:ring-primary transition"
          :class="{ 'ring-1 ring-primary': state.accentColor === 'purple' }"
          @click="setColor('purple')"
        ></button>
        <button
          class="bg-pink-400 p-2 w-10 h-10 rounded-full focus:ring-primary transition"
          :class="{ 'ring-1 ring-primary': state.accentColor === 'pink' }"
          @click="setColor('pink')"
        ></button>
        <button
          class="bg-neutral-400 p-2 w-10 h-10 rounded-full focus:ring-primary transition"
          :class="{ 'ring-1 ring-primary': state.accentColor === 'neutral' }"
          @click="setColor('neutral')"
        ></button>
      </div>
    </section>
    <!-- Interface size -->
    <section>
      <p class="mb-2">{{ translations.appearance.interfaceSize || '-' }}</p>

      <div class="grid grid-cols-4 gap-4">
        <button
          v-for="opt in [
            {
              s: 1.2,
              key: '1.2',
              label: translations.appearance.large || 'Large',
            },
            {
              s: 1.1,
              key: '1.1',
              label: translations.appearance.medium || 'Medium',
            },
            {
              s: 1.0,
              key: '1.0',
              label: translations.appearance.default || 'Default',
            },
            {
              s: 0.9,
              key: '0.9',
              label: translations.appearance.moreSpace || 'More Space',
            },
          ]"
          :key="opt.key"
          class="bg-input p-2 rounded-lg border transition focus:outline-none focus:ring-1 focus:ring-primary"
          :class="{
            'ring-1 ring-primary border-primary':
              String(state.zoomLevel) === opt.key,
          }"
          :aria-pressed="String(state.zoomLevel) === opt.key"
          type="button"
          @click="setZoom(Number(opt.key))"
        >
          <!-- Fixed-size preview frame -->
          <div
            class="w-full h-20 bg-white dark:bg-neutral-900 rounded border mb-4 overflow-hidden relative"
            :style="`--s:${opt.s}`"
          >
            <!-- Centered, scale-compensated wrapper (prevents clipping at any scale) -->
            <div class="fit-scale">
              <div class="p-1 text-center text-xs leading-4">
                <div class="font-semibold mb-1 truncate">Lorem Ipsum</div>
                <div
                  class="text-neutral-600 dark:text-neutral-300 line-clamp-3"
                >
                  Lorem ipsum dolor sit amet, consectetur adipiscing elit.
                </div>
              </div>
            </div>
          </div>

          <p class="capitalize text-center text-sm">{{ opt.label }}</p>
        </button>
      </div>
    </section>
    <!-- Font -->
    <section>
      <p class="mb-2">{{ translations.appearance.selectFont || '-' }}</p>
      <div class="flex gap-2 items-center">
        <ui-select
          v-model="state.selectedFont"
          class="w-full"
          :search="true"
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
      <p class="mb-2">{{ translations.appearance.selectCodeFont || '-' }}</p>
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

    <section>
      <p class="mb-2">{{ translations.appearance.interfaceOptions || '-' }}</p>
      <div>
        <div class="space-y-1">
          <!-- Clear Text - OLED -->
          <div class="flex items-center py-2 justify-between">
            <div>
              <span class="block text-lg align-left">
                {{ translations.appearance.clearFont || '-' }}
              </span>
            </div>
            <ui-switch v-model="ClearFontChecked" @change="toggleClearFont" />
          </div>
          <!-- Menubar visibility -->
          <div v-if="!isMacOS" class="flex items-center py-2 justify-between">
            <div>
              <span class="block text-lg align-left">
                {{ translations.appearance.menuBarVisibility || '-' }}
              </span>
            </div>
            <ui-switch
              v-model="visibilityMenubar"
              @change="toggleVisibilityOfMenubar"
            />
          </div>
        </div>
      </div>
    </section>
    <!-- App Icon -->
    <section v-if="isMobileRuntime && iconsSupported">
      <p class="mb-2">{{ translations.appearance.appIcon || 'App Icon' }}</p>
      <div class="grid grid-cols-4 gap-3">
        <button
          v-for="icon in alternateIcons"
          :key="icon.key"
          class="flex flex-col items-center gap-1 p-2 rounded-lg bg-input border transition focus:outline-none focus:ring-1 focus:ring-primary"
          :class="{
            'ring-1 ring-primary border-primary':
              currentIconName === icon.name ||
              (!currentIconName && icon.isDefault),
          }"
          @click="
            icon.isDefault ? handleResetIcon() : handleChangeIcon(icon.name)
          "
        >
          <div
            class="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-lg font-bold shadow-sm"
            :style="{ backgroundColor: icon.color }"
          >
            {{ icon.label }}
          </div>
          <span
            class="text-xs text-neutral-500 dark:text-neutral-400 truncate w-full text-center"
          >
            {{ icon.label }}
          </span>
        </button>
      </div>
    </section>
  </div>
</template>

<script>
import { shallowReactive, onMounted, computed, ref } from 'vue';
import { useTranslations } from '@/composable/useTranslations';
import { useTheme } from '@/composable/theme';
import {
  DEFAULT_UI_FONT_STACK,
  getSettingSync,
  setSetting,
} from '@/composable/settings';
import { useStorage } from '@/composable/storage';
import {
  formatZoomLevel,
  getStoredZoomLevel,
  setStoredZoomLevel,
} from '@/composable/zoom';
import { useAppStore } from '@/store/app';
import lightImg from '@/assets/images/light.png';
import darkImg from '@/assets/images/dark.png';
import systemImg from '@/assets/images/system.png';
import { getSystemFonts, setMenuVisibility } from '@/lib/native/app';
import { backend } from '@/lib/tauri-bridge';
import {
  isSupported,
  getName,
  changeIcon,
  resetIcon,
} from '@/lib/native/app-icon';

export default {
  setup() {
    const { translations } = useTranslations();
    const appStore = useAppStore();
    const themes = [
      { name: 'light', img: lightImg },
      { name: 'dark', img: darkImg },
      { name: 'system', img: systemImg },
    ];

    const layouts = [
      { name: 'default', img: lightImg },
      { name: 'columns', img: darkImg },
    ];

    const theme = useTheme();
    const storage = useStorage();

    const state = shallowReactive({
      defaultPath: '',
      password: '',
      withPassword: false,
      lastUpdated: null,
      accentColor: getSettingSync('colorScheme'),
      zoomLevel: formatZoomLevel(getStoredZoomLevel()),
      directionPreference: getSettingSync('directionPreference'),
      selectedFont: getSettingSync('selectedFont'),
      selectedCodeFont: getSettingSync('selectedCodeFont'),
    });

    let defaultPath = '';

    const isMacOS = computed(() =>
      window.navigator.platform.toLowerCase().includes('mac')
    );

    const ClearFontChecked = computed({
      get: () => getSettingSync('selectedDarkText') === '#CCCCCC',
      set: (value) => {
        void setSetting('selectedDarkText', value ? '#CCCCCC' : 'white');
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
      state.accentColor = color;
      void setSetting('colorScheme', color);
    };

    const visibilityMenubar = computed({
      get: () => getSettingSync('visibilityMenubar'),
      set: (val) => {
        void setSetting('visibilityMenubar', val);
      },
    });

    const defaultFonts = [
      {
        label: 'Default',
        value: DEFAULT_UI_FONT_STACK,
        class: '',
      },
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
        systemFonts.value = await getSystemFonts();
      } catch (e) {
        console.error('Failed to fetch system fonts', e);
      }
    });

    onMounted(() => {
      defaultPath = localStorage.getItem('default-path') || '';
      state.defaultPath = defaultPath;

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

    const toggleClearFont = () => {
      ClearFontChecked.value = !ClearFontChecked.value;
    };

    const toggleVisibilityOfMenubar = async () => {
      await setMenuVisibility(!getSettingSync('visibilityMenubar'));
    };

    const toggleDirectionPreference = () => {
      state.directionPreference =
        state.directionPreference === 'rtl' ? 'ltr' : 'rtl';
      void setSetting('directionPreference', state.directionPreference);
      document.documentElement.dir = state.directionPreference;
    };

    const updateFont = () => {
      void setSetting('selectedFont', state.selectedFont);
      document.documentElement.style.setProperty(
        '--selected-font',
        state.selectedFont
      );
    };

    const updateCodeFont = () => {
      void setSetting('selectedCodeFont', state.selectedCodeFont);
      document.documentElement.style.setProperty(
        '--selected-font-code',
        state.selectedCodeFont
      );
    };

    const setZoom = (newZoomLevel) => {
      state.zoomLevel = setStoredZoomLevel(newZoomLevel, { reload: true });
    };
    const isMobileRuntime = backend.isMobileRuntime();
    const isIOSRuntime = backend.isIOSRuntime();
    const iconsSupported = ref(false);
    const currentIconName = ref(null);

    const androidIcons = [
      { key: 'dev', name: 'dev', label: 'Dev', color: '#6b7280' },
      { key: 'dark', name: 'dark', label: 'Dark', color: '#1f2937' },
      { key: 'full', name: 'full', label: 'Full', color: '#7c3aed' },
      { key: 'space', name: 'space', label: 'Space', color: '#0ea5e9' },
      {
        key: 'darkoutline',
        name: 'darkoutline',
        label: 'Dark Outline',
        color: '#4b5563',
      },
      { key: 'felt', name: 'felt', label: 'Felt', color: '#059669' },
      { key: 'rainbow', name: 'rainbow', label: 'Rainbow', color: '#f59e0b' },
    ];

    const iosIcons = [
      { key: 'icon1', name: 'AppIcon 1', label: 'Icon 1', color: '#ef4444' },
      { key: 'icon2', name: 'AppIcon 2', label: 'Icon 2', color: '#f97316' },
      { key: 'icon3', name: 'AppIcon 3', label: 'Icon 3', color: '#eab308' },
      { key: 'icon4', name: 'AppIcon 4', label: 'Icon 4', color: '#22c55e' },
      { key: 'icon5', name: 'AppIcon 5', label: 'Icon 5', color: '#3b82f6' },
      { key: 'icon6', name: 'AppIcon 6', label: 'Icon 6', color: '#8b5cf6' },
      { key: 'icon7', name: 'AppIcon 7', label: 'Icon 7', color: '#ec4899' },
      { key: 'icon8', name: 'AppIcon 8', label: 'Icon 8', color: '#14b8a6' },
    ];

    const alternateIcons = computed(() => {
      const icons = isIOSRuntime ? iosIcons : androidIcons;
      return [
        {
          key: 'default',
          name: null,
          label: 'Default',
          color: '#6b7280',
          isDefault: true,
        },
        ...icons,
      ];
    });

    async function handleChangeIcon(name) {
      try {
        const allIcons = alternateIcons.value
          .filter((i) => !i.isDefault)
          .map((i) => i.name);
        const disable = allIcons.filter((n) => n !== name);
        await changeIcon({ name, disable });
        currentIconName.value = name;
      } catch (e) {
        console.error('Failed to change icon:', e);
      }
    }

    async function handleResetIcon() {
      try {
        const allIcons = alternateIcons.value
          .filter((i) => !i.isDefault)
          .map((i) => i.name);
        await resetIcon({ disable: allIcons });
        currentIconName.value = null;
      } catch (e) {
        console.error('Failed to reset icon:', e);
      }
    }

    onMounted(async () => {
      try {
        const supported = await isSupported();
        iconsSupported.value = supported.value;
        if (supported.value) {
          const iconName = await getName();
          currentIconName.value = iconName.value;
        }
      } catch (e) {
        console.error('App icon support check failed:', e);
      }
    });

    return {
      state,
      theme,
      themes,
      layouts,
      storage,
      translations,
      toggleClearFont,
      ClearFontChecked,
      visibilityMenubar,
      toggleVisibilityOfMenubar,
      isMacOS,
      toggleDirectionPreference,
      updateFont,
      updateCodeFont,
      setZoom,
      setColor,
      defaultFonts,
      systemFonts,
      appStore,
      isMobileRuntime,
      iconsSupported,
      currentIconName,
      alternateIcons,
      handleChangeIcon,
      handleResetIcon,
    };
  },
};
</script>
<style scoped>
/* Absolutely center the preview; size-compensate so scale never overflows */
.fit-scale {
  position: absolute;
  left: 50%;
  top: 50%;
  /* compensate size so the scaled content fits within the frame */
  width: calc(100% / var(--s));
  height: calc(100% / var(--s));
  transform: translate(-50%, -50%) scale(var(--s));
  transform-origin: center center;

  display: flex;
  align-items: center;
  justify-content: center;

  /* crisp rendering; avoids subpixel fuzz */
  transform-style: preserve-3d;
  will-change: transform;
}

/* Optional: reduce jitter on some browsers */
button {
  -webkit-tap-highlight-color: transparent;
}
</style>
