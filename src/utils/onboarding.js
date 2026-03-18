import { setSetting } from '@/composable/settings';
import { backend } from '@/lib/tauri-bridge';
import { tryRestoreAppKeyFromSafeStorage } from '@/utils/appCrypto';
import { getSyncPath } from '@/utils/syncPath';
import { tryRestoreKeyFromSafeStorage } from '@/utils/syncCrypto';

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
    setSetting('spellcheckEnabled', preferences.spellcheckEnabled),
    setSetting('openLastEdited', preferences.openLastEdited),
    setSetting('openAfterCreation', preferences.openAfterCreation),
  ]);

  theme.setTheme(preferences.theme, preferences.theme === 'system');
  document.documentElement.dir = direction;
  document.documentElement.lang = languageCode;
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
  return backend.invoke('migration:status');
}

export async function runOnboardingMigration() {
  if (backend.isMobileRuntime?.()) {
    throw new Error('Legacy migration is only available on desktop.');
  }
  await backend.invoke('migration:run');
}

export async function openOnboardingWorkspace({ store, noteStore, router }) {
  await getSyncPath();
  await Promise.allSettled([
    tryRestoreKeyFromSafeStorage(),
    tryRestoreAppKeyFromSafeStorage(),
  ]);

  await store.retrieve();

  const [latestNote] = [...noteStore.notes].sort(
    (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
  );

  await router.replace(latestNote ? `/note/${latestNote.id}` : '/');
}
