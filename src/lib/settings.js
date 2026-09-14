import { useStorage } from './storage';

const settingsStorage = useStorage('settings');
export const DEFAULT_UI_FONT_STACK =
  "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif";

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
    defaultValue: 'amber',
    parse: String,
  },
  zoomLevel: { legacyKey: 'zoomLevel', defaultValue: '1.0', parse: String },
  selectedFont: {
    legacyKey: 'selected-font',
    defaultValue: DEFAULT_UI_FONT_STACK,
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

  spellcheckEnabled: {
    legacyKey: 'spellcheckEnabled',
    defaultValue: true,
    parse: (value) => value === true || value === 'true',
  },
  reducedMotion: {
    legacyKey: 'reducedMotion',
    defaultValue: false,
    parse: (value) => value === true || value === 'true',
  },
  highContrast: {
    legacyKey: 'highContrast',
    defaultValue: false,
    parse: (value) => value === true || value === 'true',
  },
  advancedSettings: {
    legacyKey: 'advanced-settings',
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
  soundsEnabled: {
    legacyKey: 'soundsEnabled',
    defaultValue: true,
    parse: (value) => value === true || value === 'true',
  },
  spotlightEnabled: {
    legacyKey: 'spotlightEnabled',
    defaultValue: false,
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
  beaverAccountServerUrl: {
    legacyKey: 'beaverAccountServerUrl',
    defaultValue: 'https://api.beavernotes.com',
    parse: String,
  },
  syncTransport: {
    legacyKey: 'syncTransport',
    defaultValue: 'folder',
    parse: String,
  },
  collaborationEnabled: {
    legacyKey: 'collaborationEnabled',
    defaultValue: true,
    parse: (value) => value === true || value === 'true',
  },
  syncPath: {
    legacyKey: 'default-path',
    defaultValue: '',
    parse: String,
  },
  vaultJoinDeclinedPath: {
    legacyKey: 'vaultJoinDeclinedPath',
    defaultValue: '',
    parse: String,
  },
};

// Per-instance namespace for the localStorage settings mirror. Both the real app
// and any second instance share one WKWebView localStorage DB (same bundle id),
// so the mirror must be scoped to this instance's data dir; the per-instance kv
// stays the source of truth.
let mirrorNamespace = '';

export function setSettingsMirrorNamespace(namespace) {
  mirrorNamespace = namespace ? `${namespace}::` : '';
}

function getSettingDef(key) {
  const def = settingDefs[key];
  if (!def) {
    throw new Error(`Unknown setting key: ${key}`);
  }
  return def;
}

function mirrorKey(legacyKey) {
  return `${mirrorNamespace}${legacyKey}`;
}

// Shared so path.js mirrors its legacy `default-path` under the same
// per-instance namespace instead of leaking one folder to every instance.
export function settingsMirrorKey(legacyKey) {
  return mirrorKey(legacyKey);
}

function mirrorToLocalStorage(key, value) {
  const { legacyKey } = getSettingDef(key);
  if (value == null) {
    localStorage.removeItem(mirrorKey(legacyKey));
    return;
  }

  if (typeof value === 'object') {
    localStorage.setItem(mirrorKey(legacyKey), JSON.stringify(value));
    return;
  }

  localStorage.setItem(mirrorKey(legacyKey), String(value));
}

export function getSettingSync(key) {
  const { legacyKey, defaultValue, parse } = getSettingDef(key);
  const raw = localStorage.getItem(mirrorKey(legacyKey));
  return raw == null ? defaultValue : parse(raw);
}

function hasMirroredValue(key) {
  const { legacyKey } = getSettingDef(key);
  return localStorage.getItem(mirrorKey(legacyKey)) != null;
}

export async function getSetting(key) {
  const { defaultValue } = getSettingDef(key);

  // Fast path: the value is mirrored to localStorage on every read/write, so a
  // mirrored value can be returned without an IPC round-trip.
  if (hasMirroredValue(key)) {
    return getSettingSync(key);
  }

  const value = await settingsStorage.get(key, null);
  if (value == null) {
    await settingsStorage.set(key, defaultValue);
    mirrorToLocalStorage(key, defaultValue);
    return defaultValue;
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
    keys.map(async (key) => {
      try {
        return [key, await getSetting(key)];
      } catch (err) {
        console.warn(`[settings] Failed to hydrate "${key}":`, err);
        return [key, getSettingDef(key).defaultValue];
      }
    })
  );
  return Object.fromEntries(entries);
}

export function invalidateSettingMirrors(keys) {
  for (const key of keys) {
    mirrorToLocalStorage(key, null);
  }
}
