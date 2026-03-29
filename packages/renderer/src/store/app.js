import { ref } from 'vue';
import { defineStore } from 'pinia';
import { useLocalStorage } from '../composable/storage';

const parseBool = (v) => (typeof v === 'boolean' ? v : v === 'true');
const parseJson = (fallback) => (v) => {
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};

export const useAppStore = defineStore('appStore', () => {
  const settingStorage = {
    // Editor behaviour
    collapsibleHeading: useLocalStorage('collapsibleHeading', {
      defaultValue: true,
      parse: parseBool,
    }),
    openLastEdited: useLocalStorage('openLastEdited', {
      defaultValue: true,
      parse: parseBool,
    }),
    openAfterCreation: useLocalStorage('openAfterCreation', {
      defaultValue: true,
      parse: parseBool,
    }),
    // Appearance
    selectedFont: useLocalStorage('selected-font', {
      defaultValue: 'Arimo',
      parse: (v) => v || 'Arimo',
    }),
    selectedCodeFont: useLocalStorage('selected-font-code', {
      defaultValue: 'JetBrains Mono',
      parse: (v) => v || 'JetBrains Mono',
    }),
    darkText: useLocalStorage('selected-dark-text', {
      defaultValue: 'white',
      parse: (v) => v || 'white',
    }),
    colorScheme: useLocalStorage('color-scheme', {
      defaultValue: 'light',
      parse: (v) => v || 'light',
    }),
    editorWidth: useLocalStorage('editorWidth', {
      defaultValue: '54rem',
      parse: (v) => v || '54rem',
    }),
    customEditorWidth: useLocalStorage('customEditorWidth', {
      defaultValue: '60rem',
      parse: (v) => v || '60rem',
    }),
    visibilityMenubar: useLocalStorage('visibility-menubar', {
      defaultValue: false,
      parse: parseBool,
    }),
    theme: useLocalStorage('theme', {
      defaultValue: 'system',
      parse: (v) => v || 'system',
    }),
    // Editor settings
    zoomLevel: useLocalStorage('zoomLevel', {
      defaultValue: 1.0,
      parse: (v) => parseFloat(v) || 1.0,
    }),
    directionPreference: useLocalStorage('directionPreference', {
      defaultValue: 'ltr',
      parse: (v) => v || 'ltr',
    }),
    todayDateFormat: useLocalStorage('todayDateFormat', {
      defaultValue: 'DD-MM-YYYY',
      parse: (v) => v || 'DD-MM-YYYY',
    }),
    timeFormat: useLocalStorage('timeFormat', {
      defaultValue: 'HH:mm',
      parse: (v) => v || 'HH:mm',
    }),
    advancedSettings: useLocalStorage('advanced-settings', {
      defaultValue: false,
      parse: parseBool,
    }),
    // Language / locale
    selectedLanguage: useLocalStorage('selectedLanguage', {
      defaultValue: 'en',
      parse: (v) => v || 'en',
    }),
    // Sync
    autoSync: useLocalStorage('autoSync', {
      defaultValue: false,
      parse: parseBool,
    }),
    defaultPath: useLocalStorage('default-path', {
      defaultValue: '',
      parse: (v) => v ?? '',
    }),
    // App state
    lastNoteEdit: useLocalStorage('lastNoteEdit', {
      defaultValue: null,
      parse: (v) => v,
    }),
    firstTime: useLocalStorage('first-time', {
      defaultValue: null,
      parse: (v) => v,
    }),
    spellcheckEnabled: useLocalStorage('spellcheckEnabled', {
      defaultValue: false,
      parse: parseBool,
    }),
    autoUpdateEnabled: useLocalStorage('autoUpdateEnabled', {
      defaultValue: true,
      parse: parseBool,
    }),
    // Notes state
    sortNotes: useLocalStorage('sort-notes', {
      defaultValue: null,
      parse: parseJson(null),
    }),
    lockedNotes: useLocalStorage('lockedNotes', {
      defaultValue: {},
      parse: parseJson({}),
    }),
    isLocked: useLocalStorage('isLocked', {
      defaultValue: {},
      parse: parseJson({}),
    }),
    dataDir: useLocalStorage('dataDir', {
      defaultValue: '',
      parse: (v) => v ?? '',
    }),
  };

  const setting = ref(
    Object.fromEntries(
      Object.entries(settingStorage).map(([k, s]) => [k, s.get()])
    )
  );

  const loading = ref(false);

  return {
    setting,
    loading,
    setSettingStorage(key, value) {
      settingStorage[key]?.set(value);
      setting.value[key] = value;
    },
    clearSetting(key) {
      settingStorage[key]?.set(null);
      setting.value[key] = null;
    },
    // Called on app unmount / data-dir change to flush any in-memory state.
    // All settings are already written immediately via setSettingStorage, so
    // this is a no-op kept for call-site compatibility.
    updateToStorage() {},
  };
});
