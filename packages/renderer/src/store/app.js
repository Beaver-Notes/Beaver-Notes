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
    loading,
  };
});
