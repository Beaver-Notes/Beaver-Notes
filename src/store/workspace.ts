import { defineStore } from 'pinia';
import { invokeCommand } from '@/lib/tauri/commands';

interface Workspace {
  id: string;
  name: string;
}

interface WorkspaceState {
  workspaces: Workspace[];
  activeId: string | null;
  loading: boolean;
}

export const useWorkspaceStore = defineStore('workspace', {
  state: (): WorkspaceState => ({
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
          invokeCommand<Workspace[]>('workspace:list'),
          invokeCommand<{ id: string } | null>('workspace:getActive'),
        ]);
        this.workspaces = workspaces;
        this.activeId = active?.id ?? 'default';
      } finally {
        this.loading = false;
      }
    },

    async create(name: string, options: { copySettings?: boolean } = {}) {
      const ws = await invokeCommand<Workspace>('workspace:create', {
        name,
        copySettings: options.copySettings ?? false,
      });
      this.workspaces.push(ws);
      this.activeId = ws.id;
      return ws;
    },

    async switchTo(id: string) {
      if (id === this.activeId) return;
      await invokeCommand('workspace:switch', { id });
      this.activeId = id;
    },

    async rename(id: string, name: string) {
      await invokeCommand('workspace:rename', { id, name });
      const ws = this.workspaces.find((w) => w.id === id);
      if (ws) ws.name = name;
    },

    async remove(id: string) {
      await invokeCommand('workspace:delete', { id });
      this.workspaces = this.workspaces.filter((w) => w.id !== id);
    },
  },
});
