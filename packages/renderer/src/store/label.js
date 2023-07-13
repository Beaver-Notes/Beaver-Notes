import { defineStore } from 'pinia';
import { useStorage } from '../composable/storage';
import { useNoteStore } from './note';

const storage = useStorage();

export const useLabelStore = defineStore('label', {
  state: () => ({
    data: [],
  }),
  getters: {
    getByIds: (state) => (ids) => ids.filter((id) => state.data.includes(id)),
  },
  actions: {
    retrieve() {
      return new Promise((resolve) => {
        storage.get('labels', []).then((data) => {
          this.data = data;

          resolve(data);
        });
      });
    },
    add(name) {
      return new Promise((resolve) => {
        const validName = name.slice(0, 50);

        this.data.push(validName);

        storage.set('labels', this.data).then(() => resolve(validName));
      });
    },
    async delete(id) {
      try {
        const labelIndex = this.data.indexOf(id);

        if (labelIndex === -1) return null;

        const noteStore = useNoteStore();

        for (const note of noteStore.notes) {
          const noteLabelIndex = note.labels.indexOf(id);

          if (noteLabelIndex !== -1) {
            const copyLabels = [...note.labels];

            copyLabels.splice(noteLabelIndex, 1);

            await noteStore.update(note.id, {
              labels: copyLabels,
            });
          }
        }

        this.data.splice(labelIndex, 1);

        await storage.set('labels', this.data);

        return id;
      } catch (error) {
        console.error(error);
      }
    },
  },
});
