import { nanoid } from 'nanoid';
import { defineStore } from 'pinia';
import { AES } from 'crypto-es/lib/aes';
import { useStorage } from '../composable/storage';
import { Utf8 } from 'crypto-es/lib/core';

const storage = useStorage();

export const useNoteStore = defineStore('note', {
  state: () => ({
    data: {},
    lockStatus: {},
    isLocked: {},
  }),
  getters: {
    notes: (state) => Object.values(state.data).filter(({ id }) => id),
    getById: (state) => (id) => state.data[id],
  },
  actions: {
    retrieve() {
      return new Promise((resolve) => {
        const piniaData = this.data;
        const piniaLockStatus = this.lockStatus;

        storage.get('notes', {}).then((localStorageData) => {
          this.data = { ...piniaData, ...localStorageData };

          storage.get('lockStatus', {}).then((lockStatusData) => {
            this.lockStatus = { ...piniaLockStatus, ...lockStatusData };

            for (const noteId in this.data) {
              if (this.lockStatus[noteId]) {
                this.lockStatus[noteId] = lockStatusData[noteId];
              } else {
                this.lockStatus[noteId] = 'unlocked';
              }
            }

            storage.get('isLocked', {}).then((isLockedData) => {
              this.isLocked = { ...isLockedData };

              for (const noteId in this.data) {
                if (this.isLocked[noteId]) {
                  this.data[noteId].isLocked = true;
                } else {
                  this.data[noteId].isLocked = false;
                }
              }

              resolve(this.data);
            });
          });
        });
      });
    },

    add(note = {}) {
      return new Promise((resolve) => {
        const id = note.id || nanoid();
        this.data[id] = {
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

        storage.set('notes', this.data).then(() => {
          this.lockStatus[id] = 'unlocked';
          this.isLocked[id] = false;
          storage.set('lockStatus', this.lockStatus);
          storage.set('isLocked', this.isLocked);
          resolve(this.data[id]);
        });
      });
    },

    update(id, data = {}) {
      return new Promise((resolve) => {
        this.data[id] = {
          ...this.data[id],
          ...data,
        };

        storage
          .set(`notes.${id}`, this.data[id])
          .then(() => resolve(this.data[id]));
      });
    },

    async delete(id) {
      try {
        const lastEditedNote = localStorage.getItem('lastNoteEdit');
        if (lastEditedNote === id) localStorage.removeItem('lastNoteEdit');
        const { path, ipcRenderer } = window.electron;
        const dataDir = await storage.get('dataDir', '', 'settings');
        delete this.data[id];

        this.lockStatus[id] = undefined;
        this.isLocked[id] = undefined;
        storage.delete(`notes.${id}`).then(() => {
          storage.set('lockStatus', this.lockStatus);
          storage.set('isLocked', this.isLocked);
        });

        await ipcRenderer.callMain(
          'fs:remove',
          path.join(dataDir, 'notes-assets', id)
        );

        return id;
      } catch (error) {
        console.error(error);
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

        this.data[id].content = { type: 'doc', content: [encryptedContent] };
        this.data[id].isLocked = true;
        this.isLocked[id] = true;
        await storage.set(`notes.${id}`, this.data[id]);
        this.lockStatus[id] = 'locked';
        this.isLocked[id] = true;
        await Promise.all([
          storage.set('lockStatus', this.lockStatus),
          storage.set('isLocked', this.isLocked),
        ]);
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
          // Content is not encrypted, update isLocked flag and return
          this.data[id].isLocked = false;
          this.isLocked[id] = false;
          await storage.set(`notes.${id}`, this.data[id]);
          this.lockStatus[id] = 'unlocked';
          await Promise.all([
            storage.set('lockStatus', this.lockStatus),
            storage.set('isLocked', this.isLocked),
          ]);
          return;
        }

        // Content is encrypted, proceed with decryption
        const decryptedBytes = AES.decrypt(
          this.data[id].content.content[0],
          password
        );
        const decryptedContent = decryptedBytes.toString(Utf8);

        this.data[id].content = JSON.parse(decryptedContent);
        this.data[id].isLocked = false;
        this.isLocked[id] = false;
        await storage.set(`notes.${id}`, this.data[id]);
        this.lockStatus[id] = 'unlocked';
        await Promise.all([
          storage.set('lockStatus', this.lockStatus),
          storage.set('isLocked', this.isLocked),
        ]);
      } catch (error) {
        console.error('Error unlocking note:', error);
        throw error;
      }
    },

    addLabel(id, labelId) {
      return new Promise((resolve) => {
        if (this.data[id]) {
          const labelIndex = this.data[id].labels.indexOf(labelId);

          if (labelIndex === -1) {
            this.data[id].labels.push(labelId);

            storage
              .set(`notes.${id}`, this.data[id])
              .then(() => resolve(labelId));
          } else {
            resolve();
          }
        }
      });
    },
  },
});
