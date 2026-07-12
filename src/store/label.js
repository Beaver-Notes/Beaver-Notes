import { defineStore } from 'pinia';
import { useNoteStore } from './note';

import {
  syncLabel,
  removeLabel,
  syncLabelColor,
} from '@/composable/useWorkspaceYjs';

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
      // Data is already populated from the Yjs workspace doc via
      // writeStoresFromWorkspace().  No KV reads needed.
      return this.data;
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

        syncLabel(validName);
        resolve(validName);
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
        }

        removeLabel(id);

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

      syncLabelColor(name, color);

      return color;
    },
  },
});
