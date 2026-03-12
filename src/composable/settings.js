import { useStorage } from './storage';

const settingsStorage = useStorage('settings');

const settingDefs = {
  theme: { legacyKey: 'theme', defaultValue: 'system', parse: String },
  selectedLanguage: {
    legacyKey: 'selectedLanguage',
    defaultValue: 'en',
    parse: String,
  },
  directionPreference: {
    legacyKey: 'directionPreference',
    defaultValue: 'ltr',
    parse: String,
  },
  colorScheme: {
    legacyKey: 'color-scheme',
    defaultValue: 'light',
    parse: String,
  },
  zoomLevel: { legacyKey: 'zoomLevel', defaultValue: '1.0', parse: String },
  selectedFont: {
    legacyKey: 'selected-font',
    defaultValue: 'Arimo',
    parse: String,
  },
  selectedCodeFont: {
    legacyKey: 'selected-font-code',
    defaultValue: 'JetBrains Mono',
    parse: String,
  },
  selectedDarkText: {
    legacyKey: 'selected-dark-text',
    defaultValue: 'white',
    parse: String,
  },
  visibilityMenubar: {
    legacyKey: 'visibility-menubar',
    defaultValue: false,
    parse: (value) => value === true || value === 'true',
  },
  editorWidth: {
    legacyKey: 'editorWidth',
    defaultValue: '54rem',
    parse: String,
  },
  customEditorWidth: {
    legacyKey: 'customEditorWidth',
    defaultValue: '60rem',
    parse: String,
  },
  spellcheckEnabled: {
    legacyKey: 'spellcheckEnabled',
    defaultValue: true,
    parse: (value) => value === true || value === 'true',
  },
  advancedSettings: {
    legacyKey: 'advanced-settings',
    defaultValue: false,
    parse: (value) => value === true || value === 'true',
  },
  autoSync: {
    legacyKey: 'autoSync',
    defaultValue: false,
    parse: (value) => value === true || value === 'true',
  },
  todayDateFormat: {
    legacyKey: 'todayDateFormat',
    defaultValue: 'DD-MM-YYYY',
    parse: String,
  },
  timeFormat: {
    legacyKey: 'timeFormat',
    defaultValue: 'HH:mm',
    parse: String,
  },
  collapsibleHeading: {
    legacyKey: 'collapsibleHeading',
    defaultValue: true,
    parse: (value) => value === true || value === 'true',
  },
  openLastEdited: {
    legacyKey: 'openLastEdited',
    defaultValue: true,
    parse: (value) => value === true || value === 'true',
  },
  openAfterCreation: {
    legacyKey: 'openAfterCreation',
    defaultValue: true,
    parse: (value) => value === true || value === 'true',
  },
  toolbarConfig: {
    legacyKey: 'toolbarConfig',
    defaultValue: null,
    parse: (value) => {
      if (value == null || value === '') return null;
      if (Array.isArray(value)) return value;
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
  },
  onboardingCompleted: {
    legacyKey: 'onboardingCompleted',
    defaultValue: false,
    parse: (value) => value === true || value === 'true',
  },
};

function getSettingDef(key) {
  const def = settingDefs[key];
  if (!def) {
    throw new Error(`Unknown setting key: ${key}`);
  }
  return def;
}

function mirrorToLocalStorage(key, value) {
  const { legacyKey } = getSettingDef(key);
  if (value == null) {
    localStorage.removeItem(legacyKey);
    return;
  }

  if (typeof value === 'object') {
    localStorage.setItem(legacyKey, JSON.stringify(value));
    return;
  }

  localStorage.setItem(legacyKey, String(value));
}

export function getSettingSync(key) {
  const { legacyKey, defaultValue, parse } = getSettingDef(key);
  const raw = localStorage.getItem(legacyKey);
  return raw == null ? defaultValue : parse(raw);
}

export async function getSetting(key) {
  const { defaultValue } = getSettingDef(key);
  const value = await settingsStorage.get(key, null);
  if (value == null) {
    const fallback = getSettingSync(key);
    await settingsStorage.set(key, fallback);
    mirrorToLocalStorage(key, fallback);
    return fallback;
  }
  mirrorToLocalStorage(key, value);
  return value;
}

export async function setSetting(key, value) {
  mirrorToLocalStorage(key, value);
  await settingsStorage.set(key, value);
  return value;
}

export async function hydrateSettingsStore(keys = Object.keys(settingDefs)) {
  const entries = await Promise.all(
    keys.map(async (key) => [key, await getSetting(key)])
  );
  return Object.fromEntries(entries);
}
