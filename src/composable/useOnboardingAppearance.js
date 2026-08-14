import { computed } from 'vue';
import { useTranslations } from '@/composable/useTranslations';
import {
  applyOnboardingFreshPreferences,
  ONBOARDING_FONTS,
  ONBOARDING_LANGUAGES,
  ONBOARDING_THEMES,
} from '@/utils/onboarding/index.js';
import lightImg from '@/assets/images/light.png';
import darkImg from '@/assets/images/dark.png';
import systemImg from '@/assets/images/system.png';

/**
 * Onboarding appearance + fresh-start preferences: theme, accent color, font,
 * language, sounds, spotlight and zoom selectors, plus applying the chosen
 * defaults and moving to the next wizard step.
 */
export function useOnboardingAppearance({ fresh, state, theme, goToStep }) {
  const { translations } = useTranslations();

  const themeImages = { light: lightImg, dark: darkImg, system: systemImg };
  const themes = ONBOARDING_THEMES.map((item) => ({
    ...item,
    img: themeImages[item.name],
  }));
  const fonts = ONBOARDING_FONTS;
  const languages = ONBOARDING_LANGUAGES;

  const themeLabels = computed(() => ({
    light: translations.value.appearance?.light || 'Light',
    dark: translations.value.appearance?.dark || 'Dark',
    system: translations.value.appearance?.system || 'System',
  }));

  const isDark = computed(() =>
    fresh.theme === 'system' ? theme.isDark() : fresh.theme === 'dark',
  );

  async function applyFreshAndGo(target) {
    state.error = '';
    state.savingPreferences = true;
    try {
      await applyOnboardingFreshPreferences(fresh, { theme });
      goToStep(target);
    } catch (e) {
      state.error = e?.message || String(e);
    } finally {
      state.savingPreferences = false;
    }
  }

  async function prepareFreshWorkspace() {
    await applyFreshAndGo('finish');
  }

  async function useDefaultPreferences() {
    await applyFreshAndGo('account');
  }

  const selectTheme = (name) => {
    fresh.theme = name;
    theme.setTheme(name, name === 'system');
  };

  const selectAccentColor = (color) => {
    fresh.accentColor = color;
    const root = document.documentElement;
    const accentColorNames = [
      'red',
      'light',
      'green',
      'blue',
      'purple',
      'pink',
      'neutral',
    ];
    root.classList.forEach((cls) => {
      if (accentColorNames.includes(cls)) root.classList.remove(cls);
    });
    root.classList.add(color);
  };

  const selectFont = (font) => {
    fresh.selectedFont = font;
    document.documentElement.style.setProperty('--selected-font', font);
  };

  const selectLanguage = (language) => {
    fresh.language = language;
  };

  const selectSounds = (value) => {
    fresh.soundsEnabled = value;
  };

  const selectSpotlight = (value) => {
    fresh.spotlightEnabled = value;
  };

  const selectZoomLevel = (zoomLevel) => {
    fresh.zoomLevel = zoomLevel;
  };

  return {
    themes,
    fonts,
    languages,
    themeLabels,
    isDark,
    selectTheme,
    selectAccentColor,
    selectFont,
    selectLanguage,
    selectSounds,
    selectSpotlight,
    selectZoomLevel,
    prepareFreshWorkspace,
    useDefaultPreferences,
  };
}
