import { ref } from 'vue';
import { defineStore } from 'pinia';
import { getSettingSync, setSetting } from '../composable/settings';

interface AppSetting {
  collapsibleHeading: boolean;
  openLastEdited: boolean;
  openAfterCreation: boolean;
  soundsEnabled: boolean;
  spotlightEnabled: boolean;
}

export const useAppStore = defineStore('appStore', () => {
  const setting = ref<AppSetting>({
    collapsibleHeading: getSettingSync('collapsibleHeading') as boolean,
    openLastEdited: getSettingSync('openLastEdited') as boolean,
    openAfterCreation: getSettingSync('openAfterCreation') as boolean,
    soundsEnabled: getSettingSync('soundsEnabled') as boolean,
    spotlightEnabled: getSettingSync('spotlightEnabled') as boolean,
  });

  const loading = ref(false);

  return {
    setting,
    setSettingStorage: async (key: string, value: unknown) => {
      await setSetting(key, value);
      (setting.value as Record<string, unknown>)[key] = value;
    },
    toolbarStorage: {
      get: () => getSettingSync('toolbarConfig'),
      set: (value: unknown) => setSetting('toolbarConfig', value),
    },
    loading,
  };
});
