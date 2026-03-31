import { defineStore } from 'pinia';
import { useNoteStore } from './note';
import { useLabelStore } from './label';
import { usePasswordStore } from './passwd';
import { useFolderStore } from './folder';
import { useStorage } from '@/composable/storage';
import { rebuildSearchIndex } from '@/lib/native/search';

const storage = useStorage();

// Version bump this whenever the FTS schema or indexing logic changes so that
// existing users automatically get a full index rebuild on next launch.
const FTS_INDEX_VERSION = 1;

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

      if (
        values[0]?.status === 'fulfilled' &&
        values[2]?.status === 'fulfilled'
      ) {
        await noteStore.normalizeInvalidFolderIds();
      }

      // Trigger a background FTS index rebuild whenever the stored version
      // doesn't match the current FTS_INDEX_VERSION. This runs once per
      // install or after schema changes, and is entirely fire-and-forget.
      this._ensureFtsIndex().catch((err) =>
        console.warn('[fts] Background index build failed:', err)
      );

      return values
        .filter(({ status }) => status === 'fulfilled')
        .map(({ value }) => value);
    },

    async _ensureFtsIndex() {
      const storedVersion = await storage.get('fts_index_version', 0);
      if (storedVersion >= FTS_INDEX_VERSION) return;

      await rebuildSearchIndex();
      await storage.set('fts_index_version', FTS_INDEX_VERSION);
    },
  },
});
