import { defineStore } from 'pinia';
import { nanoid } from 'nanoid';
import { useStorage } from '../composable/storage';

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

          // Ensure that the lock status for each note is correctly initialized
          for (const noteId in this.data) {
            // Check local storage for lock status and set isLocked accordingly
            const lockStatus = localStorage.getItem(`noteLockStatus_${noteId}`);
            if (lockStatus === 'locked') {
              this.data[noteId].isLocked = true;
              this.isLocked[noteId] = true; // Set the isLocked property
            } else {
              this.data[noteId].isLocked = false;
              this.isLocked[noteId] = false; // Set the isLocked property
            }
          }

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
            resolve(this.data);
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
          this.isLocked[id] = false; // Set the isLocked property
          storage.set('lockStatus', this.lockStatus);
          storage.set('isLocked', this.isLocked); // Save isLocked to local storage
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
    lockNote(id) {
      if (this.data[id]) {
        this.data[id].isLocked = true;
        this.isLocked[id] = true;
        storage.set(`notes.${id}`, this.data[id]).then(() => {
          this.lockStatus[id] = 'locked';
          this.isLocked[id] = true;
          storage.set('lockStatus', this.lockStatus);
          storage.set('isLocked', this.isLocked);
          console.log(`Note (ID: ${id}) is locked`);
        });
      }
    },
    unlockNote(id) {
      if (this.data[id]) {
        this.data[id].isLocked = false;
        this.isLocked[id] = false;
        storage.set(`notes.${id}`, this.data[id]).then(() => {
          this.lockStatus[id] = 'unlocked';
          this.isLocked[id] = false; // Set the isLocked property
          storage.set('lockStatus', this.lockStatus);
          storage.set('isLocked', this.isLocked); // Save isLocked to local storage
          console.log(`Note (ID: ${id}) is unlocked`);
        });
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
