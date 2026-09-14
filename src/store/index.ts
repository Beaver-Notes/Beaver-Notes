import { defineStore } from 'pinia';
import { useNoteStore } from './note';
import { useLabelStore } from './label';
import { useFolderStore } from './folder';

interface MainState {
  activeNoteId: string;
}

export const useStore = defineStore('main', {
  state: (): MainState => ({
    activeNoteId: '',
  }),
  actions: {
    async retrieve() {
      const noteStore = useNoteStore();
      const labelStore = useLabelStore();
      const folderStore = useFolderStore();

      const values = await Promise.allSettled([
        noteStore.retrieve(),
        labelStore.retrieve(),
        folderStore.retrieve(),
      ]);

      if (
        values[0]?.status === 'fulfilled' &&
        values[2]?.status === 'fulfilled'
      ) {
        await noteStore.normalizeInvalidFolderIds();
      }

      return values
        .filter((r) => r.status === 'fulfilled')
        .map(({ value }) => value);
    },

    

  },
});
