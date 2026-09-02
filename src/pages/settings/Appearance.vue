<template>
  <div class="general mb-14 w-full max-w-xl space-y-6">
    <!-- Theme picker -->
    <div class="space-y-3">
      <h3 class="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
        {{ translations.appearance.appTheme || 'Theme' }}
      </h3>
      <div class="grid grid-cols-3 gap-3 sm:gap-4">
        <label class="cursor-pointer min-w-0 select-none">
          <input
            type="radio"
            name="theme"
            value="light"
            class="peer sr-only"
            :checked="theme.currentTheme.value === 'light'"
            @change="theme.setTheme('light')"
          />
          <div
            class="relative w-full h-[84px] sm:h-[96px] rounded-2xl border-2 overflow-hidden bg-[#f4f4f6] transition-colors"
            :class="
              theme.currentTheme.value === 'light'
                ? 'border-primary ring-2 ring-primary/20'
                : 'border-neutral-200 dark:border-neutral-700'
            "
          >
            <div
              class="absolute bottom-0 left-[14px] sm:left-[16px] right-0 h-[56px] sm:h-[64px] bg-white rounded-tl-2xl pt-2 sm:pt-2.5 pl-3 sm:pl-3.5 flex items-start"
            >
              <span
                class="text-xl sm:text-2xl font-extrabold text-black tracking-tight"
                >Aa</span
              >
            </div>
          </div>
          <span
            class="mt-1.5 block text-xs sm:text-sm font-medium text-center"
            :class="
              theme.currentTheme.value === 'light'
                ? 'text-primary'
                : 'text-neutral-600 dark:text-neutral-400'
            "
            >{{ translations.appearance.light || 'Light' }}</span
          >
        </label>

        <label class="cursor-pointer min-w-0 select-none">
          <input
            type="radio"
            name="theme"
            value="dark"
            class="peer sr-only"
            :checked="theme.currentTheme.value === 'dark'"
            @change="theme.setTheme('dark')"
          />
          <div
            class="relative w-full h-[84px] sm:h-[96px] rounded-2xl border-2 overflow-hidden bg-[#3c3c3c] transition-colors"
            :class="
              theme.currentTheme.value === 'dark'
                ? 'border-primary ring-2 ring-primary/20'
                : 'border-neutral-200 dark:border-neutral-700'
            "
          >
            <div
              class="absolute bottom-0 left-[14px] sm:left-[16px] right-0 h-[56px] sm:h-[64px] bg-[#121212] rounded-tl-2xl pt-2 sm:pt-2.5 pl-3 sm:pl-3.5 flex items-start"
            >
              <span
                class="text-xl sm:text-2xl font-extrabold text-white tracking-tight"
                >Aa</span
              >
            </div>
          </div>
          <span
            class="mt-1.5 block text-xs sm:text-sm font-medium text-center"
            :class="
              theme.currentTheme.value === 'dark'
                ? 'text-primary'
                : 'text-neutral-600 dark:text-neutral-400'
            "
            >{{ translations.appearance.dark || 'Dark' }}</span
          >
        </label>

        <label class="cursor-pointer min-w-0 select-none">
          <input
            type="radio"
            name="theme"
            value="system"
            class="peer sr-only"
            :checked="theme.currentTheme.value === 'system'"
            @change="theme.setTheme('system')"
          />
          <div
            class="relative w-full h-[84px] sm:h-[96px] rounded-2xl border-2 overflow-hidden flex transition-colors"
            :class="
              theme.currentTheme.value === 'system'
                ? 'border-primary ring-2 ring-primary/20'
                : 'border-neutral-200 dark:border-neutral-700'
            "
          >
            <div class="w-1/2 h-full bg-[#3c3c3c]"></div>
            <div class="w-1/2 h-full bg-[#f4f4f6]"></div>
            <div
              class="absolute bottom-0 left-[14px] sm:left-[16px] right-1/2 h-[56px] sm:h-[64px] bg-[#121212] rounded-tl-2xl pt-2 sm:pt-2.5 pl-3 sm:pl-3.5"
            >
              <span
                class="text-xl sm:text-2xl font-extrabold text-white tracking-tight"
                >Aa</span
              >
            </div>
            <div
              class="absolute bottom-0 left-[52%] right-0 h-[56px] sm:h-[64px] bg-white rounded-tl-2xl pt-2 sm:pt-2.5 pl-3 sm:pl-3.5 flex items-start border-l border-black/10"
            >
              <span
                class="text-xl sm:text-2xl font-extrabold text-black tracking-tight"
                >Aa</span
              >
            </div>
          </div>
          <span
            class="mt-1.5 block text-xs sm:text-sm font-medium text-center"
            :class="
              theme.currentTheme.value === 'system'
                ? 'text-primary'
                : 'text-neutral-600 dark:text-neutral-400'
            "
            >{{ translations.appearance.system || 'System' }}</span
          >
        </label>
      </div>
    </div>

    <settings-group
      :title="translations.appearance.colorScheme || 'Accent color'"
    >
      <settings-row
        :label="translations.appearance.colorScheme || 'Accent color'"
        description="Pick the highlight used for selections and buttons."
      >
        <div class="flex flex-wrap gap-2.5">
          <button
            v-for="c in accentColors"
            :key="c.key"
            type="button"
            class="w-8 h-8 rounded-full transition focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary dark:focus:ring-offset-neutral-900"
            :class="c.class"
            :aria-label="c.label"
            :aria-pressed="state.accentColor === c.key"
            :title="c.label"
            @click="setColor(c.key)"
          >
            <span
              v-if="state.accentColor === c.key"
              class="flex items-center justify-center w-full h-full"
            >
              <v-remixicon
                name="riCheckLine"
                size="16"
                class="text-white drop-shadow"
              />
            </span>
          </button>
        </div>
      </settings-row>
    </settings-group>

    <div :title="translations.appearance.interfaceSize || 'Interface size'">
      <div class="px-4 pt-3 pb-1">
        <p
          class="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
        >
          Adjust text and UI size. Smaller shows more content.
        </p>
      </div>
      <div class="p-4 pt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div
          v-for="opt in [
            {
              s: 0.9,
              key: '0.9',
              label: translations.appearance.moreSpace || 'More Space',
              px: 15,
            },
            {
              s: 1.0,
              key: '1.0',
              label: translations.appearance.default || 'Default',
              px: 17,
            },
            {
              s: 1.1,
              key: '1.1',
              label: translations.appearance.medium || 'Medium',
              px: 19,
            },
            {
              s: 1.2,
              key: '1.2',
              label: translations.appearance.large || 'Large',
              px: 22,
            },
          ]"
          :key="opt.key"
          class="flex flex-col items-center gap-1.5"
        >
          <button
            type="button"
            class="relative w-full bg-white dark:bg-neutral-900 p-4 rounded-xl border-2 transition flex flex-col items-center gap-2 focus:outline-none"
            :class="
              String(state.zoomLevel) === opt.key
                ? 'border-primary ring-2 ring-primary/20'
                : 'border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700'
            "
            :aria-pressed="String(state.zoomLevel) === opt.key"
            @click="setZoom(Number(opt.key))"
          >
            <span
              v-if="String(state.zoomLevel) === opt.key"
              class="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-primary flex items-center justify-center text-white shadow-sm"
              ><v-remixicon name="riCheckLine" size="12"
            /></span>
            <span
              class="font-bold leading-none tabular-nums text-neutral-900 dark:text-white"
              :style="{ fontSize: opt.px + 'px' }"
              >A</span
            >
          </button>
          <span
            class="text-[11px] font-medium tracking-wide uppercase text-center"
            :class="
              String(state.zoomLevel) === opt.key
                ? 'text-primary'
                : 'text-neutral-500 dark:text-neutral-400'
            "
            >{{ opt.label }}</span
          >
        </div>
      </div>
    </div>

    <settings-group :title="translations.appearance.font || 'Typography'">
      <settings-row
        control-id="appearance-font"
        :label="translations.appearance.selectFont || 'Interface font'"
        description="Font for the app shell and note list."
        control-class="w-full sm:w-56"
      >
        <ui-select
          id="appearance-font"
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
      </settings-row>

      <settings-row
        control-id="appearance-code-font"
        :label="translations.appearance.selectCodeFont || 'Code font'"
        description="Font for code blocks and inline code."
        control-class="w-full sm:w-56"
      >
        <ui-select
          id="appearance-code-font"
          v-model="state.selectedCodeFont"
          class="w-full"
          @change="updateCodeFont"
        >
          <option value="Anonymous Pro" class="anonymous-pro">
            Anonymous Pro
          </option>
          <option value="Hack" class="font-hack">
            {{ tr.hack || 'Hack' }}
          </option>
          <option value="JetBrains Mono" class="font-JetBrainsMono">
            JetBrains Mono
          </option>
          <option value="Source Code Pro" class="font-source-code-pro">
            Source Code Pro
          </option>
        </ui-select>
      </settings-row>
    </settings-group>

    <settings-group
      :title="translations.appearance.interfaceOptions || 'Interface options'"
    >
      <settings-row
        control-id="appearance-clear-font"
        :label="translations.appearance.clearFont || 'Softer text in dark mode'"
        description="Use a lighter gray for text in dark mode — easier on OLED screens."
      >
        <ui-switch id="appearance-clear-font" v-model="ClearFontChecked" />
      </settings-row>

      <settings-row
        control-id="appearance-reduced-motion"
        :label="translations.appearance.reducedMotion || 'Reduced motion'"
        description="Minimize animations and transitions."
      >
        <ui-switch
          id="appearance-reduced-motion"
          v-model="reducedMotion"
          @change="toggleReducedMotion"
        />
      </settings-row>

      <settings-row
        v-if="isDesktopRuntime && !isMacOS"
        control-id="appearance-menubar"
        :label="translations.appearance.menuBarVisibility || 'Menu bar'"
        description="Show the application menu bar."
      >
        <ui-switch
          id="appearance-menubar"
          v-model="visibilityMenubar"
          @change="toggleVisibilityOfMenubar"
        />
      </settings-row>
    </settings-group>

    <settings-group
      v-if="isMobileRuntime && iconsSupported"
      :title="translations.appearance.appIcon || 'App icon'"
    >
      <div class="px-4 py-4 grid grid-cols-4 gap-3">
        <button
          v-for="icon in alternateIcons"
          :key="icon.key"
          class="flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition focus:outline-none focus:ring-1 focus:ring-primary"
          :class="
            currentIconName === icon.name ||
            (!currentIconName && icon.isDefault)
              ? 'border-primary'
              : 'border-transparent'
          "
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
    </settings-group>
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
} from '@/lib/settings';
import {
  formatZoomLevel,
  getStoredZoomLevel,
  setStoredZoomLevel,
} from '@/utils/ui/zoom';
import { useAppStore } from '@/store/app';
import {
  getSystemFonts,
  setMenuVisibility,
  setReducedMotion,
} from '@/lib/native/app';
import { isMacOSRuntime } from '@/lib/tauri/runtime';
import { backend } from '@/lib/tauri-bridge';
import {
  isSupported,
  getName,
  changeIcon,
  resetIcon,
} from '@/lib/native/app-icon';
import SettingsGroup from '@/components/settings/SettingsGroup.vue';
import SettingsRow from '@/components/settings/SettingsRow.vue';

export default {
  components: { SettingsGroup, SettingsRow },
  setup() {
    const { translations } = useTranslations();
    const tr = computed(() => translations.value?.appearanceView || {});
    function fmt(key, params) {
      const raw = tr.value[key] ?? key;
      if (!params) return raw;
      return Object.entries(params).reduce(
        (s, [k, v]) => s.replace(`{${k}}`, String(v)),
        raw,
      );
    }
    const appStore = useAppStore();

    const theme = useTheme();

    const rawAccent = getSettingSync('colorScheme');
    const state = shallowReactive({
      accentColor: rawAccent === 'light' ? 'amber' : rawAccent,
      zoomLevel: formatZoomLevel(getStoredZoomLevel()),
      directionPreference: getSettingSync('directionPreference'),
      selectedFont: getSettingSync('selectedFont'),
      selectedCodeFont: getSettingSync('selectedCodeFont'),
    });
    if (rawAccent === 'light') void setSetting('colorScheme', 'amber');

    const isMacOS = computed(() => isMacOSRuntime());

    const ClearFontChecked = computed({
      get: () => getSettingSync('selectedDarkText') === '#CCCCCC',
      set: (value) => {
        void setSetting('selectedDarkText', value ? '#CCCCCC' : 'white');
        document.documentElement.style.setProperty(
          '--selected-dark-text',
          value ? '#CCCCCC' : 'white',
        );
      },
    });

    const THEME_COLOR_CLASSES = [
      'red',
      'amber',
      'green',
      'blue',
      'purple',
      'pink',
      'neutral',
      'light',
      'dark',
    ];

    const accentColors = [
      { key: 'red', label: 'Red', class: 'bg-red-500' },
      { key: 'amber', label: 'Amber', class: 'bg-amber-400' },
      { key: 'green', label: 'Green', class: 'bg-emerald-500' },
      { key: 'blue', label: 'Blue', class: 'bg-blue-400' },
      { key: 'purple', label: 'Purple', class: 'bg-purple-400' },
      { key: 'pink', label: 'Pink', class: 'bg-pink-400' },
      { key: 'neutral', label: 'Neutral', class: 'bg-neutral-400' },
    ];

    const setColor = (color) => {
      const root = document.documentElement;
      [...root.classList].forEach((cls) => {
        if (THEME_COLOR_CLASSES.includes(cls)) {
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

    const reducedMotion = computed({
      get: () => getSettingSync('reducedMotion'),
      set: (val) => {
        void setSetting('reducedMotion', val);
      },
    });

    const defaultFonts = [
      { label: 'Default', value: DEFAULT_UI_FONT_STACK, class: '' },
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
      document.documentElement.style.setProperty(
        '--selected-font',
        state.selectedFont,
      );
      document.documentElement.style.setProperty(
        '--selected-font-code',
        state.selectedCodeFont,
      );
      document.documentElement.dir = state.directionPreference;
    });

    const toggleVisibilityOfMenubar = async () => {
      await setMenuVisibility(!getSettingSync('visibilityMenubar'));
    };

    const toggleReducedMotion = async (val) => {
      const enabled =
        typeof val === 'boolean' ? val : !getSettingSync('reducedMotion');
      document.documentElement.classList.toggle(
        'prefers-reduced-motion',
        enabled,
      );
      void setReducedMotion(enabled).catch(() => {});
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
        state.selectedFont,
      );
    };

    const updateCodeFont = () => {
      void setSetting('selectedCodeFont', state.selectedCodeFont);
      document.documentElement.style.setProperty(
        '--selected-font-code',
        state.selectedCodeFont,
      );
    };

    const setZoom = (newZoomLevel) => {
      state.zoomLevel = setStoredZoomLevel(newZoomLevel, { reload: true });
    };
    const isDesktopRuntime = backend.isDesktopRuntime();
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
      translations,
      tr,
      fmt,
      ClearFontChecked,
      visibilityMenubar,
      toggleVisibilityOfMenubar,
      reducedMotion,
      toggleReducedMotion,
      isMacOS,
      isDesktopRuntime,
      toggleDirectionPreference,
      updateFont,
      updateCodeFont,
      setZoom,
      setColor,
      accentColors,
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
button {
  -webkit-tap-highlight-color: transparent;
}
</style>
