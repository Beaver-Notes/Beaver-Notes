import { defineStore } from 'pinia';
import { useNoteStore } from './note';
import { useLabelStore } from './label';

export const useStore = defineStore('main', {
  state: () => ({
    inFocusMode: false,
    activeNoteId: '',
  }),
  actions: {
    retrieve() {
      return new Promise((resolve) => {
        const noteStore = useNoteStore();
        const labelStore = useLabelStore();

        const promises = Promise.allSettled([
          noteStore.retrieve(),
          labelStore.retrieve(),
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
