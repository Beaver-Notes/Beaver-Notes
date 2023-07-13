import { defineStore } from 'pinia';
import { nanoid } from 'nanoid';
import { useStorage } from '../composable/storage';

const storage = useStorage();

export const useNoteStore = defineStore('note', {
  state: () => ({
    data: {},
  }),
  getters: {
    notes: (state) => Object.values(state.data).filter(({ id }) => id),
    getById: (state) => (id) => state.data[id],
  },
  actions: {
    retrieve() {
      return new Promise((resolve) => {
        storage.get('notes', {}).then((data) => {
          this.data = data;

          resolve(data);
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
          ...note,
        };

        storage.set('notes', this.data).then(() => resolve(this.data[id]));
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

        await ipcRenderer.callMain(
          'fs:remove',
          path.join(dataDir, 'notes-assets', id)
        );
        await storage.delete(`notes.${id}`);

        return id;
      } catch (error) {
        console.error(error);
      }
    },
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

          return;
        }

        resolve();
      }
    });
  },
});
