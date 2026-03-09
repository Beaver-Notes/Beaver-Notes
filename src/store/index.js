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
    retrieve() {
      return new Promise((resolve) => {
        const noteStore = useNoteStore();
        const labelStore = useLabelStore();
        const folderStore = useFolderStore();
        const passwordStore = usePasswordStore();

        const promises = Promise.allSettled([
          noteStore.retrieve(),
          labelStore.retrieve(),
          folderStore.retrieve(),
          passwordStore.retrieve(),
        ]);

        promises.then((values) => {
          const result = [];

          values.forEach(({ value, status }) => {
            if (status === 'fulfilled') result.push(value);
          });

          resolve(result);
        });
      });
    },
  },
});
