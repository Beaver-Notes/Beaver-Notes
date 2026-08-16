/**
 * Import legacy Electron user preferences (from Chromium localStorage) into
 * the new settings store. Only keys that exist in the new app's settings
 * schema are written; everything else is ignored.
 */
import { setSetting } from '@/lib/settings';
import { readLegacyPreferences } from '@/lib/native/app';

const LEGACY_TO_NEW = {
  'selected-font': 'selectedFont',
  'selected-font-code': 'selectedCodeFont',
  'selected-dark-text': 'selectedDarkText',
  'color-scheme': 'colorScheme',
  theme: 'theme',
  zoomLevel: 'zoomLevel',
  directionPreference: 'directionPreference',
  selectedLanguage: 'selectedLanguage',
  spellcheckEnabled: 'spellcheckEnabled',
  'visibility-menubar': 'visibilityMenubar',
  openLastEdited: 'openLastEdited',
  openAfterCreation: 'openAfterCreation',
  collapsibleHeading: 'collapsibleHeading',
  'default-path': 'syncPath',
};

export async function importLegacyPreferences(dir) {
  let prefs = {};
  try {
    prefs = (await readLegacyPreferences(dir)) || {};
  } catch (err) {
    console.warn('[onboarding] legacy preferences read failed:', err?.message || err);
    return 0;
  }

  let written = 0;
  for (const [legacyKey, newKey] of Object.entries(LEGACY_TO_NEW)) {
    const value = prefs[legacyKey];
    if (value == null || value === '') continue;
    try {
      await setSetting(newKey, value);
      written++;
    } catch (err) {
      console.warn(`[onboarding] failed to import preference ${legacyKey}:`, err?.message || err);
    }
  }
  return written;
}
