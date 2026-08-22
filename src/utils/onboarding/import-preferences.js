/**
 * Import legacy Electron user preferences (from Chromium localStorage) into
 * the new settings store. Only keys that exist in the new app's settings
 * schema are written; everything else is ignored.
 */
import { setSetting, getSettingSync } from '@/lib/settings';
import { readLegacyPreferences } from '@/lib/native/app';
import { SYNC_TRANSPORT } from '@/lib/api/types';

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

    if (newKey === 'syncPath') {
      // Cloud-sync users have no local sync path — an explicitly cleared
      // syncPath must not be resurrected from legacy prefs. Only local
      // (folder) transport imports the legacy default path.
      const transport = getSettingSync('syncTransport');
      if (transport === SYNC_TRANSPORT.REMOTE || transport === 'cloud') {
        continue;
      }
      try {
        // Write through setSyncPath (not setSetting) so the memoized
        // getSyncPath cache is invalidated and the imported path wins.
        const { setSyncPath } = await import('@/utils/sync/path.js');
        await setSyncPath(value);
        written++;
      } catch (err) {
        console.warn(`[onboarding] failed to import preference ${legacyKey}:`, err?.message || err);
      }
      continue;
    }

    try {
      await setSetting(newKey, value);
      written++;
    } catch (err) {
      console.warn(`[onboarding] failed to import preference ${legacyKey}:`, err?.message || err);
    }
  }
  return written;
}
