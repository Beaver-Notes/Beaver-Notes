import { DEFAULT_UI_FONT_STACK, setSetting } from '@/lib/settings';
import { setStoredZoomLevel } from '@/utils/ui/zoom';
import { backend } from '@/lib/tauri-bridge';
import { enableIndexing } from '@/lib/native/spotsearch';
import { reindexAllNotes } from '@/utils/platform/spotlightSync';
import { setSyncPath } from '@/utils/sync/path';

// Re-export the legacy/Electron migration helpers under stable onboarding names.
export {
  getLegacyMigrationStatus as getOnboardingMigrationStatus,
  probeLegacyPath as probeCustomMigrationPath,
  runLegacyMigration as runOnboardingMigration,
  runLegacyMigrationFromPath as runOnboardingMigrationFromPath,
} from '@/utils/migration/legacyElectron';

import { ONBOARDING_LANGUAGE_CONFIG } from '@/utils/i18n/languages.js';
export { ONBOARDING_LANGUAGE_CONFIG, ONBOARDING_LANGUAGES } from '@/utils/i18n/languages.js';

export function getLanguageDirection(languageCode) {
  return ONBOARDING_LANGUAGE_CONFIG[languageCode]?.dir || 'ltr';
}

// ─── Animation timing constants ──────────────────────────────────────────────

export const ENTRANCE_DELAYS = {
  logo: 120,
  text: 580,
  cta: 1020,
};

export const CURTAIN_DURATIONS = {
  close: 1200,
  hold: 200,
  open: 1200,
};

// ─── Language / theme config data ────────────────────────────────────────────
// ONBOARDING_LANGUAGE_CONFIG and ONBOARDING_LANGUAGES are re-exported from @/utils/i18n/languages.js

export const ONBOARDING_THEMES = [
  { name: 'light', label: 'Light' },
  { name: 'dark', label: 'Dark' },
  { name: 'system', label: 'System' },
];

export const ONBOARDING_ACCENT_COLORS = [
  { name: 'red', className: 'bg-red-500' },
  { name: 'amber', className: 'bg-amber-400' },
  { name: 'green', className: 'bg-emerald-500' },
  { name: 'blue', className: 'bg-blue-400' },
  { name: 'purple', className: 'bg-purple-400' },
  { name: 'pink', className: 'bg-pink-400' },
  { name: 'neutral', className: 'bg-neutral-400' },
];

const ONBOARDING_ACCENT_COLOR_NAMES = ONBOARDING_ACCENT_COLORS.map(
  ({ name }) => name
);

export const ONBOARDING_INTERFACE_SIZES = [
  { value: 1.2, key: '1.2', label: 'Large' },
  { value: 1.1, key: '1.1', label: 'Medium' },
  { value: 1.0, key: '1.0', label: 'Default' },
  { value: 0.9, key: '0.9', label: 'More Space' },
];

export const ONBOARDING_FONTS = [
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

// ─── Onboarding actions ──────────────────────────────────────────────────────

export async function applyOnboardingFreshPreferences(preferences, { theme }) {
  const languageCode = preferences.language;
  const direction = getLanguageDirection(languageCode);

  await Promise.all([
    setSetting('theme', preferences.theme),
    setSetting('selectedLanguage', languageCode),
    setSetting('directionPreference', direction),
    setSetting('colorScheme', preferences.accentColor),
    setSetting('selectedFont', preferences.selectedFont),
    setSetting('spellcheckEnabled', preferences.spellcheckEnabled),
    setSetting('openLastEdited', preferences.openLastEdited),
    setSetting('openAfterCreation', preferences.openAfterCreation),
    setSetting('soundsEnabled', preferences.soundsEnabled),
    setSetting('spotlightEnabled', preferences.spotlightEnabled),
  ]);

  if (backend.isAppleRuntime() && preferences.spotlightEnabled) {
    try {
      await enableIndexing(true);
      const { useNoteStore } = await import('@/store/note');
      const noteStore = useNoteStore();
      await reindexAllNotes(noteStore.data, true);
    } catch (e) {
      console.error('[onboarding] Failed to enable Spotlight:', e);
    }
  }

  theme.setTheme(preferences.theme, preferences.theme === 'system');
  setStoredZoomLevel(preferences.zoomLevel, { syncDocument: true });
  document.documentElement.dir = direction;
  document.documentElement.lang = languageCode;
  document.documentElement.style.setProperty(
    '--selected-font',
    preferences.selectedFont
  );

  const root = document.documentElement;
  // include legacy light/dark aliases — amber canonical, light/dark are same color in tailwind.config.cjs
  const allAccentNames = [...ONBOARDING_ACCENT_COLOR_NAMES, 'light', 'dark'];
  ;[...root.classList].forEach((cls) => {
    if (allAccentNames.includes(cls)) {
      root.classList.remove(cls);
    }
  });
  root.classList.add(preferences.accentColor);
}

export async function applyOnboardingSyncPreferences(preferences) {
  await setSyncPath(preferences.syncPath || '');
}

export async function markOnboardingCompleted() {
  await setSetting('onboardingCompleted', true);
}
