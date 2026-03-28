import { DEFAULT_UI_FONT_STACK, setSetting } from '@/composable/settings';
import { setStoredZoomLevel } from '@/composable/zoom';
import { backend } from '@/lib/tauri-bridge';
import { getMigrationStatus, runMigration } from '@/lib/native/app';
import { tryRestoreAppKeyFromSafeStorage } from '@/utils/appCrypto';
import { getSyncPath, setSyncPath } from '@/utils/sync/path';
import { tryRestoreKeyFromSafeStorage } from '@/utils/sync/crypto';

export const ONBOARDING_LANGUAGE_CONFIG = {
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
  vi: { name: 'Tiếng Việt', dir: 'ltr' },
  zh: { name: '简体中文', dir: 'ltr' },
};

export const ONBOARDING_LANGUAGES = Object.entries(
  ONBOARDING_LANGUAGE_CONFIG
).map(([code, { name }]) => ({
  code,
  name,
  value: code,
  text: name,
}));

export const ONBOARDING_THEMES = [
  { name: 'light', label: 'Light' },
  { name: 'dark', label: 'Dark' },
  { name: 'system', label: 'System' },
];

export const ONBOARDING_ACCENT_COLORS = [
  { name: 'red', className: 'bg-red-500' },
  { name: 'light', className: 'bg-amber-400' },
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

export function getLanguageDirection(languageCode) {
  return ONBOARDING_LANGUAGE_CONFIG[languageCode]?.dir || 'ltr';
}

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
  ]);

  theme.setTheme(preferences.theme, preferences.theme === 'system');
  setStoredZoomLevel(preferences.zoomLevel, { syncDocument: true });
  document.documentElement.dir = direction;
  document.documentElement.lang = languageCode;
  document.documentElement.style.setProperty(
    '--selected-font',
    preferences.selectedFont
  );

  const root = document.documentElement;
  root.classList.forEach((cls) => {
    if (ONBOARDING_ACCENT_COLOR_NAMES.includes(cls)) {
      root.classList.remove(cls);
    }
  });
  root.classList.add(preferences.accentColor);
}

export async function applyOnboardingSyncPreferences(preferences) {
  await Promise.all([
    setSyncPath(preferences.syncPath || ''),
    setSetting('autoSync', Boolean(preferences.autoSync)),
  ]);
}

export async function markOnboardingCompleted(settingsStorage) {
  await settingsStorage.set('onboardingCompleted', true);
}

export async function getOnboardingMigrationStatus() {
  if (backend.isMobileRuntime?.()) {
    return {
      legacyDir: null,
      appDataDir: null,
      hasLegacyData: false,
      alreadyMigrated: false,
      targetHasData: false,
    };
  }
  return getMigrationStatus();
}

export async function runOnboardingMigration() {
  if (backend.isMobileRuntime?.()) {
    throw new Error('Legacy migration is only available on desktop.');
  }
  await runMigration();
}

export async function openOnboardingWorkspace({ store, noteStore, router }) {
  await getSyncPath();
  await Promise.allSettled([
    tryRestoreKeyFromSafeStorage(),
    tryRestoreAppKeyFromSafeStorage(),
  ]);

  await store.retrieve();

  if (backend.isMobileRuntime?.()) {
    await router.replace('/');
    return;
  }

  const [latestNote] = [...noteStore.notes].sort(
    (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
  );

  await router.replace(latestNote ? `/note/${latestNote.id}` : '/');
}
