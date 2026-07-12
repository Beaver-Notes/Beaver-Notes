import { defineStore } from 'pinia';
import { invokeCommand } from '@/lib/tauri/commands';

export const useWorkspaceStore = defineStore('workspace', {
  state: () => ({
    workspaces: [],
    activeId: null,
    loading: false,
  }),

  getters: {
    activeWorkspace: (state) =>
      state.workspaces.find((w) => w.id === state.activeId) ?? null,
  },

  actions: {
    async retrieve() {
      this.loading = true;
      try {
        const [workspaces, active] = await Promise.all([
          invokeCommand('workspace:list'),
          invokeCommand('workspace:getActive'),
        ]);
        this.workspaces = workspaces;
        this.activeId = active?.id ?? 'default';
      } finally {
        this.loading = false;
      }
    },

    async create(name, options = {}) {
      const ws = await invokeCommand('workspace:create', {
        name,
        copySettings: options.copySettings ?? false,
      });
      this.workspaces.push(ws);
      this.activeId = ws.id;
      return ws;
    },

    async switchTo(id) {
      if (id === this.activeId) return;
      await invokeCommand('workspace:switch', { id });
      this.activeId = id;
    },

    async rename(id, name) {
      await invokeCommand('workspace:rename', { id, name });
      const ws = this.workspaces.find((w) => w.id === id);
      if (ws) ws.name = name;
    },

    async remove(id) {
      await invokeCommand('workspace:delete', { id });
      this.workspaces = this.workspaces.filter((w) => w.id !== id);
    },
  },
});
