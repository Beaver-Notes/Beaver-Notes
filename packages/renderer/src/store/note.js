import { nanoid } from 'nanoid';
import { defineStore } from 'pinia';
import { useAppStore } from './app';
import { useFolderStore } from './folder';
import { AES } from 'crypto-es/lib/aes.js';
import { useStorage } from '../composable/storage.js';
import { Utf8 } from 'crypto-es/lib/core.js';
import { trackChange } from '@/utils/sync.js';

const storage = useStorage();

function findAllNodesInRange(fragment, name) {
  if (!fragment) {
    return [];
  }
  if (!Array.isArray(fragment)) {
    return findAllNodesInRange(fragment.content, name);
  }
  const nodes = [];
  for (const n of fragment) {
    if (n.type === name) {
      nodes.push(n);
      continue;
    }
    nodes.push(...findAllNodesInRange(n.content, name));
  }
  return nodes;
}

function unCollapsedFootnotes(note, footnotes) {
  let lastNode = note.content.content.at(-1);
  if (lastNode.type !== 'footnotes') {
    lastNode = {
      type: 'footnotes',
      content: [],
      attrs: { class: 'footnotes' },
    };
    note.content.content.push(lastNode);
  }
  const footnoteMap = [...footnotes, ...lastNode.content].reduce(
    (a, c) => ({ ...a, [c.attrs['data-id']]: c }),
    {}
  );
  const references = findAllNodesInRange(
    note.content.content,
    'footnoteReference'
  );
  lastNode.content = references.map((r, i) => {
    if (r.attrs['data-id'] in footnoteMap) {
      return footnoteMap[r.attrs['data-id']];
    }
    return {
      type: 'footnote',
      content: [
        {
          type: 'paragraph',
          content: [],
        },
      ],
      attrs: { 'data-id': r.attrs['data-id'], id: `fn:${i + 1}` },
    };
  });
}

export const useNoteStore = defineStore('note', {
  state: () => ({
    data: {},
    lockStatus: {},
    isLocked: {},
    syncInProgress: false,
    deletedIds: {},
  }),

  getters: {
    notes: (state) => Object.values(state.data).filter(({ id }) => id),

    getById: (state) => (id) => state.data[id],

    getByFolder:
      (state) =>
      (folderId = null) => {
        return Object.values(state.data).filter(
          (note) => note.folderId === folderId && note.id
        );
      },

    getFolderContents:
      (state) =>
      (folderId = null) => {
        const folderStore = useFolderStore();

        const notes = Object.values(state.data)
          .filter((note) => note.folderId === folderId && note.id)
          .sort((a, b) => b.updatedAt - a.updatedAt);

        const folders = folderStore
          .getByParent(folderId)
          .sort((a, b) => a.name.localeCompare(b.name));

        return { folders, notes };
      },

    searchNotes: (state) => (query) => {
      const searchTerm = query.toLowerCase();
      return Object.values(state.data).filter((note) => {
        if (!note.id) return false;
        return (
          note.title.toLowerCase().includes(searchTerm) ||
          JSON.stringify(note.content).toLowerCase().includes(searchTerm)
        );
      });
    },

    getNotesWithPath:
      (state) =>
      (notes = null) => {
        const folderStore = useFolderStore();
        const notesToProcess =
          notes || Object.values(state.data).filter(({ id }) => id);

        return notesToProcess.map((note) => ({
          ...note,
          folderPath: note.folderId ? folderStore.getPath(note.folderId) : [],
        }));
      },

    getNotesCountByFolder:
      (state) =>
      (folderId = null) => {
        return Object.values(state.data).filter(
          (note) => note.folderId === folderId && note.id
        ).length;
      },
  },

  actions: {
    async retrieve() {
      try {
        const piniaData = this.data;
        const localStorageData = await storage.get('notes', {});
        this.data = { ...piniaData, ...localStorageData };

        await this.migrateLockData();

        return this.data;
      } catch (error) {
        console.error('Error retrieving notes:', error);
        throw error;
      }
    },

    async migrateLockData() {
      const lockStatusData = await storage.get('lockStatus', {});
      const isLockedData = await storage.get('isLocked', {});

      for (const noteId in this.data) {
        const wasLocked =
          lockStatusData[noteId] === 'locked' || isLockedData[noteId] === true;
        const currentLockStatus = this.data[noteId].isLocked;

        if (wasLocked) {
          this.data[noteId].isLocked = true;
        } else if (currentLockStatus === true) {
          // If the note was already marked as locked, do nothing
        } else {
          this.data[noteId].isLocked = false;
        }
      }

      if (
        Object.keys(lockStatusData).length > 0 ||
        Object.keys(isLockedData).length > 0
      ) {
        await storage.delete('lockStatus');
        await storage.delete('isLocked');
      }

      await storage.set('notes', this.data);
    },

    async add(note = {}) {
      try {
        if (note.folderId) {
          const folderStore = useFolderStore();
          const folderExists = await folderStore.exists(note.folderId);
          if (!folderExists) {
            throw new Error('Specified folder does not exist');
          }
        }

        const id = note.id || nanoid();
        const newNote = {
          id,
          title: '',
          content: { type: 'doc', content: [] },
          labels: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          isBookmarked: false,
          isArchived: false,
          isLocked: false,
          folderId: note.folderId || null,
          ...note,
        };

        this.data[id] = newNote;

        await storage.set('notes', this.data);

        await trackChange(`notes.${id}`, this.data[id]);

        return this.data[id];
      } catch (error) {
        console.error('Error adding note:', error);
        throw error;
      }
    },

    async moveToFolder(noteId, folderId) {
      try {
        if (!this.data[noteId]) {
          throw new Error('Note not found');
        }

        if (folderId) {
          const folderStore = useFolderStore();
          const folderExists = await folderStore.exists(folderId);
          if (!folderExists) {
            throw new Error('Target folder does not exist');
          }
        }

        return await this.update(noteId, { folderId });
      } catch (error) {
        console.error('Error moving note to folder:', error);
        throw error;
      }
    },

    async moveMultipleToFolder(noteIds, folderId) {
      try {
        if (folderId) {
          const folderStore = useFolderStore();
          const folderExists = await folderStore.exists(folderId);
          if (!folderExists) {
            throw new Error('Target folder does not exist');
          }
        }

        const results = [];
        for (const noteId of noteIds) {
          if (this.data[noteId]) {
            const result = await this.update(noteId, { folderId });
            results.push(result);
          }
        }
        return results;
      } catch (error) {
        console.error('Error moving multiple notes to folder:', error);
        throw error;
      }
    },

    async handleFolderDeletion(deletionResult) {
      try {
        const {
          deletedFolderId,
          descendantIds,
          moveContentsTo,
          deleteContents,
        } = deletionResult;

        const affectedFolderIds = [deletedFolderId, ...descendantIds];
        const affectedNotes = Object.values(this.data).filter((note) =>
          affectedFolderIds.includes(note.folderId)
        );

        if (deleteContents) {
          for (const note of affectedNotes) {
            await this.delete(note.id);
          }
        } else {
          for (const note of affectedNotes) {
            await this.update(note.id, { folderId: moveContentsTo });
          }
        }

        return affectedNotes.map((note) => note.id);
      } catch (error) {
        console.error('Error handling folder deletion:', error);
        throw error;
      }
    },

    async duplicateToFolder(noteId, targetFolderId) {
      try {
        const originalNote = this.data[noteId];
        if (!originalNote) {
          throw new Error('Note not found');
        }

        if (targetFolderId) {
          const folderStore = useFolderStore();
          const folderExists = await folderStore.exists(targetFolderId);
          if (!folderExists) {
            throw new Error('Target folder does not exist');
          }
        }

        const duplicatedNote = await this.add({
          ...originalNote,
          id: undefined,
          title: `${originalNote.title} (Copy)`,
          folderId: targetFolderId,
        });

        return duplicatedNote;
      } catch (error) {
        console.error('Error duplicating note to folder:', error);
        throw error;
      }
    },

    convertNote(id) {
      const note = this.data[id];
      let footnotes = [];
      note.content.content = this.uncollapseHeading(
        note.content.content ?? [],
        footnotes
      );
      if (footnotes.length > 0) {
        unCollapsedFootnotes(note, footnotes);
      }
    },

    uncollapseHeading(contents, footnotes) {
      if (contents.length === 0) {
        return contents;
      }
      let newContents = [];
      for (let i = 0; i < contents.length; i++) {
        const content = contents[i];
        newContents.push(content);
        if (content.type === 'heading') {
          let collapsedContent = content.attrs.collapsedContent ?? [];
          let collapsedFootnotes = content.attrs.collapsedFootnotes ?? [];
          if (collapsedFootnotes.length > 0) {
            footnotes.push(...collapsedFootnotes);
          }
          if (typeof collapsedContent === 'string') {
            if (collapsedContent === '') {
              collapsedContent = [];
            } else {
              collapsedContent = JSON.parse(collapsedContent);
            }
          }
          content.attrs.open = true;
          content.attrs.collapsedContent = null;
          content.attrs.collapsedFootnotes = null;
          if (collapsedContent.length === 0) {
            continue;
          }
          newContents = [
            ...newContents,
            ...this.uncollapseHeading(collapsedContent, footnotes),
          ];
        }
      }
      return newContents;
    },

    async update(id, data = {}) {
      try {
        if (data.folderId !== undefined && data.folderId !== null) {
          const folderStore = useFolderStore();
          const folderExists = await folderStore.exists(data.folderId);
          if (!folderExists) {
            throw new Error('Specified folder does not exist');
          }
        }

        this.data[id] = {
          ...this.data[id],
          ...data,
          updatedAt: Date.now(),
        };

        await storage.set(`notes.${id}`, this.data[id]);

        await trackChange(`notes.${id}`, this.data[id]);

        return this.data[id];
      } catch (error) {
        console.error('Error updating note:', error);
        throw error;
      }
    },

    async delete(id) {
      try {
        const lastEditedNote = localStorage.getItem('lastNoteEdit');
        if (lastEditedNote === id) localStorage.removeItem('lastNoteEdit');

        const { path, ipcRenderer } = window.electron;
        const dataDir = await storage.get('dataDir', '', 'settings');

        this.deletedIds = this.deletedIds || {};
        if (!this.deletedIds[id]) {
          this.deletedIds[id] = Date.now();
        }

        delete this.data[id];

        await storage.delete(`notes.${id}`);
        await storage.set('deletedIds', this.deletedIds);

        await trackChange(`notes.${id}`, this.data[id]);
        await trackChange('deletedIds', this.deletedIds);

        try {
          await ipcRenderer.callMain(
            'fs:remove',
            path.join(dataDir, 'notes-assets', id)
          );
          await ipcRenderer.callMain(
            'fs:remove',
            path.join(dataDir, 'file-assets', id)
          );
        } catch (fileError) {
          console.warn('Error removing note files:', fileError);
        }

        this.cleanupDeletedIds(30);

        return id;
      } catch (error) {
        console.error('Error deleting note:', error);
        throw error;
      }
    },

    cleanupDeletedIds(days = 30) {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const toDelete = [];

      for (const [id, timestamp] of Object.entries(this.deletedIds || {})) {
        if (timestamp < cutoff) {
          toDelete.push(id);
        }
      }

      for (const id of toDelete) {
        delete this.deletedIds[id];
      }

      storage.set('deletedIds', this.deletedIds);
      trackChange('deletedIds', this.deletedIds);

      return toDelete;
    },

    async lockNote(id, password) {
      if (!password) {
        console.error('No password provided.');
        return;
      }

      try {
        const encryptedContent = AES.encrypt(
          JSON.stringify(this.data[id].content),
          password
        ).toString();

        this.data[id].content = { type: 'doc', content: [encryptedContent] };
        this.data[id].isLocked = true;
        this.data[id].updatedAt = Date.now();

        await storage.set(`notes.${id}`, this.data[id]);

        await trackChange(`notes.${id}`, this.data[id]);
      } catch (error) {
        console.error('Error locking note:', error);
        throw error;
      }
    },

    async unlockNote(id, password) {
      if (!password) {
        console.error('No password provided.');
        return;
      }

      try {
        const note = this.data[id];
        if (!note) {
          console.error('Note not found.');
          return;
        }

        const isEncrypted =
          typeof note.content.content[0] === 'string' &&
          note.content.content[0].trim().length > 0;

        if (!isEncrypted) {
          this.data[id].isLocked = false;
          this.data[id].updatedAt = Date.now();

          await storage.set(`notes.${id}`, this.data[id]);
          await trackChange(`notes.${id}`, this.data[id]);
          return;
        }

        try {
          const decryptedBytes = AES.decrypt(
            this.data[id].content.content[0],
            password
          );
          const decryptedContent = decryptedBytes.toString(Utf8);
          this.data[id].content = JSON.parse(decryptedContent);
        } catch (decryptError) {
          console.error('Failed to decrypt note:', decryptError);
          throw new Error('Incorrect password');
        }

        const appStore = useAppStore();
        if (!appStore.setting.collapsibleHeading) {
          this.convertNote(id);
        }

        this.data[id].isLocked = false;
        this.data[id].updatedAt = Date.now();

        await storage.set(`notes.${id}`, this.data[id]);
        await trackChange(`notes.${id}`, this.data[id]);
      } catch (error) {
        console.error('Error unlocking note:', error);
        throw error;
      }
    },

    async addLabel(id, labelId) {
      try {
        if (!this.data[id]) {
          console.error('Note not found');
          return;
        }

        const labelIndex = this.data[id].labels.indexOf(labelId);
        if (labelIndex !== -1) {
          return labelId;
        }

        this.data[id].labels.push(labelId);
        this.data[id].updatedAt = Date.now();

        await storage.set(`notes.${id}`, this.data[id]);

        await trackChange(`notes.${id}`, this.data[id]);

        return labelId;
      } catch (error) {
        console.error('Error adding label:', error);
        throw error;
      }
    },

    async removeLabel(id, labelId) {
      try {
        if (!this.data[id]) {
          console.error('Note not found');
          return;
        }

        const labelIndex = this.data[id].labels.indexOf(labelId);
        if (labelIndex === -1) {
          return;
        }

        this.data[id].labels.splice(labelIndex, 1);
        this.data[id].updatedAt = Date.now();

        await storage.set(`notes.${id}`, this.data[id]);

        await trackChange(`notes.${id}`, this.data[id]);

        return labelId;
      } catch (error) {
        console.error('Error removing label:', error);
        throw error;
      }
    },
  },
});
