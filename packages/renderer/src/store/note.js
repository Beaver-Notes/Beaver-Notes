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
    isLocked: {}, // Add a new property for isLocked
  }),
  getters: {
    notes: (state) => Object.values(state.data).filter(({ id }) => id),
    getById: (state) => (id) => state.data[id],
  },
  actions: {
    retrieve() {
      return new Promise((resolve) => {
        // Try to load data from Pinia store
        const piniaData = this.data;
        const piniaLockStatus = this.lockStatus;

        // Try to load data from local storage
        storage.get('notes', {}).then((localStorageData) => {
          // Merge data from Pinia and local storage, giving priority to local storage
          this.data = { ...piniaData, ...localStorageData };

          // Load lock status data from local storage
          storage.get('lockStatus', {}).then((lockStatusData) => {
            // Update the lock status data in Pinia from local storage
            this.lockStatus = { ...piniaLockStatus, ...lockStatusData };

            // Ensure that the lock status for each note is correctly initialized
            for (const noteId in this.data) {
              if (this.lockStatus[noteId]) {
                this.lockStatus[noteId] = lockStatusData[noteId];
              } else {
                // Default to "unlocked" if no lock status is found
                this.lockStatus[noteId] = 'unlocked';
              }
            }

            // Load isLocked data from local storage
            storage.get('isLocked', {}).then((isLockedData) => {
              // Update the isLocked data in Pinia from local storage
              this.isLocked = { ...isLockedData };

              // Ensure that the isLocked status for each note is correctly initialized
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
          isLocked: false, // Initially, the note is not locked
          ...note,
        };

        // Save the note data in local storage and lock status in both local storage and Pinia
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

        // Save the updated note data in local storage
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

        // Remove the lock status and note data from both local storage and Pinia
        this.lockStatus[id] = undefined;
        this.isLocked[id] = undefined; // Set the isLocked property
        storage.delete(`notes.${id}`).then(() => {
          storage.set('lockStatus', this.lockStatus);
          storage.set('isLocked', this.isLocked); // Save isLocked to local storage
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
          JSON.stringify(this.data[id].content), // Encrypt the entire content object
          password
        ).toString();

        // Overwrite the content property with the encrypted content
        this.data[id].content = { type: 'doc', content: [encryptedContent] };
        this.data[id].isLocked = true;
        this.isLocked[id] = true;
        // Save encrypted note data to storage
        await storage.set(`notes.${id}`, this.data[id]);
        // Update lock status in storage
        this.lockStatus[id] = 'locked';
        this.isLocked[id] = true;
        await Promise.all([
          storage.set('lockStatus', this.lockStatus),
          storage.set('isLocked', this.isLocked),
        ]);
        console.log(`Note (ID: ${id}) is locked`);
      } catch (error) {
        console.error('Error locking note:', error);
        throw error;
      }
    },

    async unlockNote(id, password) {
      if (!password) {
        console.error('No password provided.');
        return; // Exit the function if no password is provided
      }

      // Perform decryption only if password is provided
      try {
        const decryptedBytes = AES.decrypt(
          this.data[id].content.content[0], // Access the encrypted content from the array
          password
        ); // Decrypt the encrypted content
        const decryptedContent = decryptedBytes.toString(Utf8);

        this.data[id].content = JSON.parse(decryptedContent); // Replace the content with the decrypted content
        this.data[id].isLocked = false;
        this.isLocked[id] = false;
        // Save decrypted note data to storage
        await storage.set(`notes.${id}`, this.data[id]);
        // Update lock status in storage
        this.lockStatus[id] = 'unlocked';
        this.isLocked[id] = false;
        await Promise.all([
          storage.set('lockStatus', this.lockStatus),
          storage.set('isLocked', this.isLocked),
        ]);
        console.log(`Note (ID: ${id}) is unlocked`);
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

            // Save the updated note data in local storage
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
