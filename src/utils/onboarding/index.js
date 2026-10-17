import { setSetting } from '@/lib/settings';
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

// ONBOARDING_LANGUAGE_CONFIG and ONBOARDING_LANGUAGES are re-exported from @/utils/i18n/languages.js

export async function applyOnboardingSyncPreferences(preferences) {
  await setSyncPath(preferences.syncPath || '');
}

export async function markOnboardingCompleted() {
  await setSetting('onboardingCompleted', true);
}
