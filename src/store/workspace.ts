import { defineStore } from 'pinia';
import { useCloudWorkspaces } from '@/composable/useCloudWorkspaces';

interface Workspace {
  id: string;
  name: string;
  role?: string;
  ownerId?: string | null;
  storageUsedBytes?: number;
  createdAt?: string | null;
  emoji?: string | null;
  color?: string | null;
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
        const cloud = useCloudWorkspaces();
        await cloud.fetchWorkspaces();
        this.workspaces = (cloud.workspaces.value as Workspace[]).map((w) => ({
          id: w.id,
          name: w.name,
          role: w.role,
          ownerId: w.ownerId,
          storageUsedBytes: w.storageUsedBytes,
          createdAt: w.createdAt,
          emoji: w.emoji,
          color: w.color,
        }));
        if (cloud.activeId.value) {
          this.activeId = cloud.activeId.value;
        } else if (this.workspaces.length > 0 && !this.activeId) {
          this.activeId = this.workspaces[0].id;
        }
      } finally {
        this.loading = false;
      }
    },

    async create(name: string, options: { copySettings?: boolean; emoji?: string; color?: string } = {}) {
      const cloud = useCloudWorkspaces();
      const ws = await cloud.createWorkspace(name, { emoji: options.emoji, color: options.color });
      this.workspaces.push({
        id: ws.id,
        name: ws.name,
        role: ws.role,
        ownerId: ws.ownerId,
        storageUsedBytes: ws.storageUsedBytes,
        createdAt: ws.createdAt,
        emoji: ws.emoji,
        color: ws.color,
      });
      this.activeId = ws.id;
      return ws;
    },

    async switchTo(id: string) {
      if (id === this.activeId) return;
      const cloud = useCloudWorkspaces();
      await cloud.switchWorkspace(id);
      this.activeId = id;
    },

    async rename(id: string, name: string) {
      const cloud = useCloudWorkspaces();
      await cloud.renameWorkspace(id, name);
      const ws = this.workspaces.find((w) => w.id === id);
      if (ws) ws.name = name;
    },

    async remove(id: string) {
      const cloud = useCloudWorkspaces();
      await cloud.deleteWorkspace(id);
      this.workspaces = this.workspaces.filter((w) => w.id !== id);
      if (this.activeId === id) {
        this.activeId = this.workspaces[0]?.id ?? null;
      }
    },
  },
});
