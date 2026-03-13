import { defineStore } from 'pinia';
import { useNoteStore } from './note';
import { useLabelStore } from './label';
import { usePasswordStore } from './passwd';
import { useFolderStore } from './folder';

export const useStore = defineStore('main', {
  state: () => ({
    inReaderMode: false,
    activeNoteId: '',
    showPrompt: false,
  }),
  actions: {
    async retrieve() {
      const noteStore = useNoteStore();
      const labelStore = useLabelStore();
      const folderStore = useFolderStore();
      const passwordStore = usePasswordStore();

      const values = await Promise.allSettled([
        noteStore.retrieve(),
        labelStore.retrieve(),
        folderStore.retrieve(),
        passwordStore.retrieve(),
      ]);

      return values
        .filter(({ status }) => status === 'fulfilled')
        .map(({ value }) => value);
    },
  },
});
