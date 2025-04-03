import { nanoid } from 'nanoid';
import { defineStore } from 'pinia';
import { useAppStore } from './app';
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
  }),
  getters: {
    notes: (state) => Object.values(state.data).filter(({ id }) => id),
    getById: (state) => (id) => state.data[id],
  },
  actions: {
    async retrieve() {
      try {
        const piniaData = this.data;
        const piniaLockStatus = this.lockStatus;

        const localStorageData = await storage.get('notes', {});
        this.data = { ...piniaData, ...localStorageData };

        const lockStatusData = await storage.get('lockStatus', {});
        this.lockStatus = { ...piniaLockStatus, ...lockStatusData };

        for (const noteId in this.data) {
          if (this.lockStatus[noteId]) {
            this.lockStatus[noteId] = lockStatusData[noteId];
          } else {
            this.lockStatus[noteId] = 'unlocked';
          }
        }

        const isLockedData = await storage.get('isLocked', {});
        this.isLocked = { ...isLockedData };

        for (const noteId in this.data) {
          if (this.isLocked[noteId]) {
            this.data[noteId].isLocked = true;
          } else {
            this.data[noteId].isLocked = false;
          }
        }

        return this.data;
      } catch (error) {
        console.error('Error retrieving notes:', error);
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

    async add(note = {}) {
      try {
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
          ...note,
        };

        this.data[id] = newNote;
        this.lockStatus[id] = 'unlocked';
        this.isLocked[id] = false;

        // Save to local storage
        await storage.set('notes', this.data);
        await storage.set('lockStatus', this.lockStatus);
        await storage.set('isLocked', this.isLocked);

        // Track the change for sync
        await trackChange('notes', this.data);
        await trackChange('lockStatus', this.lockStatus);
        await trackChange('isLocked', this.isLocked);

        return this.data[id];
      } catch (error) {
        console.error('Error adding note:', error);
        throw error;
      }
    },

    async update(id, data = {}) {
      try {
        // Update note with new data
        this.data[id] = {
          ...this.data[id],
          ...data,
          updatedAt: Date.now(), // Always update the timestamp
        };

        // Save to local storage
        await storage.set(`notes.${id}`, this.data[id]);

        // Track the change for sync
        await trackChange('notes', this.data);

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

        // Delete from store
        delete this.data[id];
        delete this.lockStatus[id];
        delete this.isLocked[id];

        // Delete from storage
        await storage.delete(`notes.${id}`);
        await storage.set('lockStatus', this.lockStatus);
        await storage.set('isLocked', this.isLocked);

        // Track the changes for sync
        await trackChange('notes', this.data);
        await trackChange('lockStatus', this.lockStatus);
        await trackChange('isLocked', this.isLocked);

        // Remove associated files
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
          // Continue even if file deletion fails
        }

        return id;
      } catch (error) {
        console.error('Error deleting note:', error);
        throw error;
      }
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

        // Update note with encrypted content and lock status
        this.data[id].content = { type: 'doc', content: [encryptedContent] };
        this.data[id].isLocked = true;
        this.data[id].updatedAt = Date.now();
        this.isLocked[id] = true;
        this.lockStatus[id] = 'locked';

        // Save to storage
        await storage.set(`notes.${id}`, this.data[id]);
        await Promise.all([
          storage.set('lockStatus', this.lockStatus),
          storage.set('isLocked', this.isLocked),
        ]);

        // Track changes for sync
        await trackChange('notes', this.data);
        await trackChange('lockStatus', this.lockStatus);
        await trackChange('isLocked', this.isLocked);
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

        // Check if content is encrypted
        const isEncrypted =
          typeof note.content.content[0] === 'string' &&
          note.content.content[0].trim().length > 0;

        if (!isEncrypted) {
          // Content is not encrypted, update isLocked flag only
          this.data[id].isLocked = false;
          this.data[id].updatedAt = Date.now();
          this.isLocked[id] = false;
          this.lockStatus[id] = 'unlocked';

          await storage.set(`notes.${id}`, this.data[id]);
          await Promise.all([
            storage.set('lockStatus', this.lockStatus),
            storage.set('isLocked', this.isLocked),
          ]);

          // Track changes for sync
          await trackChange('notes', this.data);
          await trackChange('lockStatus', this.lockStatus);
          await trackChange('isLocked', this.isLocked);
          return;
        }

        // Decrypt the content
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

        // Update collapsible heading if needed
        const appStore = useAppStore();
        if (!appStore.setting.collapsibleHeading) {
          this.convertNote(id);
        }

        // Update lock status
        this.data[id].isLocked = false;
        this.data[id].updatedAt = Date.now();
        this.isLocked[id] = false;
        this.lockStatus[id] = 'unlocked';

        // Save to storage
        await storage.set(`notes.${id}`, this.data[id]);
        await Promise.all([
          storage.set('lockStatus', this.lockStatus),
          storage.set('isLocked', this.isLocked),
        ]);

        // Track changes for sync
        await trackChange('notes', this.data);
        await trackChange('lockStatus', this.lockStatus);
        await trackChange('isLocked', this.isLocked);
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
          // Label already exists on this note
          return labelId;
        }

        // Add the label
        this.data[id].labels.push(labelId);
        this.data[id].updatedAt = Date.now();

        // Save to storage
        await storage.set(`notes.${id}`, this.data[id]);

        // Track change for sync
        await trackChange('notes', this.data);

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
          // Label doesn't exist on this note
          return;
        }

        // Remove the label
        this.data[id].labels.splice(labelIndex, 1);
        this.data[id].updatedAt = Date.now();

        // Save to storage
        await storage.set(`notes.${id}`, this.data[id]);

        // Track change for sync
        await trackChange('notes', this.data);

        return labelId;
      } catch (error) {
        console.error('Error removing label:', error);
        throw error;
      }
    },

    // Handle incoming sync updates (called by sync system when changes are pulled)
    async applyRemoteChanges(entityType, remoteData) {
      if (this.syncInProgress) return;

      try {
        this.syncInProgress = true;

        if (entityType === 'notes') {
          // Merge the remote notes with local notes
          // Keep newer versions based on updatedAt timestamp
          const mergedNotes = { ...this.data };

          for (const [noteId, remoteNote] of Object.entries(remoteData)) {
            const localNote = this.data[noteId];

            // If note doesn't exist locally or remote is newer, use remote
            if (!localNote || remoteNote.updatedAt > localNote.updatedAt) {
              mergedNotes[noteId] = remoteNote;
            }
          }

          this.data = mergedNotes;
          await storage.set('notes', this.data);
        } else if (entityType === 'lockStatus') {
          this.lockStatus = { ...this.lockStatus, ...remoteData };
          await storage.set('lockStatus', this.lockStatus);
        } else if (entityType === 'isLocked') {
          this.isLocked = { ...this.isLocked, ...remoteData };
          await storage.set('isLocked', this.isLocked);
        }
      } catch (error) {
        console.error('Error applying remote changes:', error);
        throw error;
      } finally {
        this.syncInProgress = false;
      }
    },
  },
});
