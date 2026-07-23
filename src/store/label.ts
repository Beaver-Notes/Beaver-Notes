import { defineStore } from 'pinia';
import { useNoteStore } from './note';

import {
  syncLabel,
  removeLabel,
  syncLabelColor,
} from '@/composable/useWorkspaceYjs';

interface LabelState {
  data: string[];
  colors: Record<string, string>;
}

export const useLabelStore = defineStore('label', {
  state: (): LabelState => ({
    data: [],
    colors: {},
  }),

  getters: {
    getByIds: (state) => (ids: string[]) => ids.filter((id) => state.data.includes(id)),
    getColor: (state) => (name: string) => state.colors[name] ?? null,
  },

  actions: {
    async retrieve() {
      return this.data;
    },

    add(name: string) {
      return new Promise<string | null>((resolve) => {
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

    async delete(id: string) {
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

        if (this.colors[id]) {
          delete this.colors[id];
        }

        removeLabel(id);

        return id;
      } catch (error) {
        console.error(error);
      }
    },

    async setColor(name: string, color: string | null) {
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
