import { ref } from 'vue';
import { defineStore } from 'pinia';
import { useStorage } from '../composable/storage';

const storage = useStorage('settings');

export const useAppStore = defineStore('appStore', () => {
  const authRecords = ref([]);
  const updateFromStorage = async () => {
    authRecords.value = await storage.get('authRecords', []);
  };
  const updateToStorage = async () => {
    await storage.set('authRecords', authRecords.value);
  };
  return {
    authRecords,
    updateFromStorage,
    updateToStorage,
  };
});
