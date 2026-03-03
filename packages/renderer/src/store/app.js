import { ref } from 'vue';
import { defineStore } from 'pinia';
import { useLocalStorage } from '../composable/storage';

export const useAppStore = defineStore('appStore', () => {
  const settingStorage = {
    collapsibleHeading: useLocalStorage('collapsibleHeading', {
      defaultValue: true,
      parse: (v) => (typeof v === 'boolean' ? v : v === 'true'),
    }),
    openLastEdited: useLocalStorage('openLastEdited', {
      defaultValue: true,
      parse: (v) => (typeof v === 'boolean' ? v : v === 'true'),
    }),
    openAfterCreation: useLocalStorage('openAfterCreation', {
      defaultValue: true,
      parse: (v) => (typeof v === 'boolean' ? v : v === 'true'),
    }),
    // Toolbar order/visibility — raw JSON array, logic lives in useToolbarConfig
    toolbarConfig: useLocalStorage('toolbarConfig', {
      defaultValue: null,
      parse: (v) => {
        try {
          const parsed = typeof v === 'string' ? JSON.parse(v) : v;
          return Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      },
    }),
  };

  const setting = ref({
    collapsibleHeading: settingStorage.collapsibleHeading.get(),
    openLastEdited: settingStorage.openLastEdited.get(),
    openAfterCreation: settingStorage.openAfterCreation.get(),
  });

  const loading = ref(false);

  return {
    setting,
    setSettingStorage: (key, value) => {
      settingStorage[key]?.set(value);
      setting.value[key] = value;
    },
    toolbarStorage: settingStorage.toolbarConfig,
    loading,
  };
});
