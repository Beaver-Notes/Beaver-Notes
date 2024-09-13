import { ref } from 'vue';
import { defineStore } from 'pinia';
import { useStorage, useLocalStorage } from '../composable/storage';

const storage = useStorage('settings');

export const useAppStore = defineStore('appStore', () => {
  const authRecords = ref([]);
  const updateFromStorage = async () => {
    authRecords.value = await storage.get('authRecords', []);
  };
  const updateToStorage = async () => {
    await storage.set('authRecords', authRecords.value);
  };
  const settingStorage = {
    collapsibleHeading: useLocalStorage('collapsibleHeading', {
      defaultvalue: true,
      parse: (v) => (typeof v === 'boolean' ? v : v === 'true'),
    }),
    openLastEdited: useLocalStorage('openLastEdited', {
      defaultvalue: true,
      parse: (v) => (typeof v === 'boolean' ? v : v === 'true'),
    }),
  };

  const setting = ref({
    collapsibleHeading: settingStorage.collapsibleHeading.get(),
    openLastEdited: settingStorage.openLastEdited.get(),
  });

  const loading = ref(false);
  return {
    authRecords,
    updateFromStorage,
    updateToStorage,
    setting,
    setSettingStorage: (key, value) => {
      settingStorage[key]?.set(value);
      setting.value[key] = value;
    },
    loading,
  };
});
