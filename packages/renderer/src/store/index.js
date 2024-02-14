import { defineStore } from 'pinia';
import { useNoteStore } from './note';
import { useLabelStore } from './label';
import { usePasswordStore } from './passwd';

export const useStore = defineStore('main', {
  state: () => ({
    inFocusMode: false,
    activeNoteId: '',
    showPrompt: false,
  }),
  actions: {
    retrieve() {
      return new Promise((resolve) => {
        const noteStore = useNoteStore();
        const labelStore = useLabelStore();
        const passwordStore = usePasswordStore(); // Instantiate the usePasswordStore

        const promises = Promise.allSettled([
          noteStore.retrieve(),
          labelStore.retrieve(),
          passwordStore.retrieve(), // Retrieve password hashes
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
