import { defineStore } from 'pinia';
import { useStorage } from '../composable/storage';
import { useNoteStore } from './note';
import { trackChange } from '@/utils/sync';

const storage = useStorage();

async function loadColors() {
  return storage.get('labelColors', {});
}

export const useLabelStore = defineStore('label', {
  state: () => ({
    data: [],
    colors: {}, // { [labelName]: '#hexcolor' }
  }),

  getters: {
    getByIds: (state) => (ids) => ids.filter((id) => state.data.includes(id)),
    getColor: (state) => (name) => state.colors[name] ?? null,
  },

  actions: {
    async retrieve() {
      const [labels, colors] = await Promise.all([
        storage.get('labels', []),
        loadColors(),
      ]);

      // Prune color entries for labels that no longer exist
      const labelSet = new Set(labels);
      let colorsDirty = false;
      for (const name of Object.keys(colors)) {
        if (!labelSet.has(name)) {
          delete colors[name];
          colorsDirty = true;
        }
      }
      if (colorsDirty) {
        await storage.set('labelColors', colors);
      }

      this.data = labels;
      this.colors = colors;
      return labels;
    },

    add(name) {
      return new Promise((resolve) => {
        if (typeof name !== 'string' || name.trim() === '') {
          console.error('Invalid name:', name);
          resolve(null);
          return;
        }

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
            await noteStore.update(note.id, { labels: copyLabels });
          }
        }

        this.data.splice(labelIndex, 1);

        // Clean up color entry if one existed
        if (this.colors[id]) {
          delete this.colors[id];
          await storage.set('labelColors', this.colors);
        }

        await storage.set('labels', this.data);

        return id;
      } catch (error) {
        console.error(error);
      }
    },

    async setColor(name, color) {
      if (!this.data.includes(name)) return null;

      if (color) {
        this.colors[name] = color;
      } else {
        delete this.colors[name];
      }

      await storage.set('labelColors', this.colors);
      await trackChange('labelColors', this.colors);

      return color;
    },
  },
});
