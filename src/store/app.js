import { ref } from 'vue';
import { defineStore } from 'pinia';
import { getSettingSync, setSetting } from '../composable/settings';

export const useAppStore = defineStore('appStore', () => {
  const setting = ref({
    collapsibleHeading: getSettingSync('collapsibleHeading'),
    openLastEdited: getSettingSync('openLastEdited'),
    openAfterCreation: getSettingSync('openAfterCreation'),
  });

  const loading = ref(false);

  return {
    setting,
    setSettingStorage: async (key, value) => {
      await setSetting(key, value);
      setting.value[key] = value;
    },
    toolbarStorage: {
      get: () => getSettingSync('toolbarConfig'),
      set: (value) => setSetting('toolbarConfig', value),
    },
    loading,
  };
});
