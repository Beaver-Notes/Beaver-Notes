import { defineStore } from 'pinia';
import { useNoteStore } from './note';
import { useLabelStore } from './label';
import { usePasswordStore } from './passwd';
import { useFolderStore } from './folder';

const REINDEX_FLAG = 'bn_reindex_completed';

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

      const promises = await Promise.allSettled([
        noteStore.retrieve(),
        labelStore.retrieve(),
        folderStore.retrieve(),
        passwordStore.retrieve(),
      ]);

      const result = [];
      promises.forEach(({ value, status }) => {
        if (status === 'fulfilled') result.push(value);
      });

      this.runReindex();

      return result;
    },

    async runReindex() {
      try {
        const noteStore = useNoteStore();
        const reindexCompleted = localStorage.getItem(REINDEX_FLAG);
        console.log('[Reindex] reindex_completed flag:', reindexCompleted);
        if (!reindexCompleted) {
          console.log('[Reindex] Starting reindex...');
          await noteStore.reindexInvalidFolderIds();
          localStorage.setItem(REINDEX_FLAG, 'true');
          console.log('[Reindex] Complete, flag set to true');
        } else {
          console.log('[Reindex] Already completed, skipping');
        }
      } catch (error) {
        console.error('[Reindex] Failed:', error);
      }
    },
  },
});
