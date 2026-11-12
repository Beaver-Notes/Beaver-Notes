import { defineStore } from 'pinia';
import { useCloudWorkspaces } from '@/composable/useCloudWorkspaces';
import {
  getActiveLocalWorkspace,
  listLocalWorkspaces,
} from '@/lib/native/workspaces';

interface Workspace {
  id: string;
  name: string;
  role?: string;
  ownerId?: string | null;
  storageUsedBytes?: number;
  createdAt?: string | null;
  emoji?: string | null;
  color?: string | null;
  // A workspace that lives only on this device: it has no server counterpart,
  // so switching to it must never push its notes under the account's token.
  local?: boolean;
}

interface WorkspaceState {
  workspaces: Workspace[];
  activeId: string | null;
  loading: boolean;
}

// The Rust workspace registry has no emoji/color columns, so a local
// workspace's decoration lives here instead of being lost on every retrieve().
const LOCAL_DECORATION_KEY = 'beaver.localWorkspaceDecorations';

type Decoration = { emoji?: string | null; color?: string | null };

function readLocalDecorations(): Record<string, Decoration> {
  try {
    const raw = localStorage.getItem(LOCAL_DECORATION_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Decoration>) : {};
  } catch {
    return {};
  }
}

export function saveLocalWorkspaceDecoration(id: string, patch: Decoration) {
  try {
    const all = readLocalDecorations();
    all[id] = { ...all[id], ...patch };
    localStorage.setItem(LOCAL_DECORATION_KEY, JSON.stringify(all));
  } catch {
    // Cosmetic only: private mode or a quota error just skips the icon.
  }
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
    /**
     * Drop the decrypted workspace list. Names arrive decrypted from the cloud
     * layer, so they are cleared on sign-out with everything else the previous
     * account owned.
     */
    reset() {
      this.workspaces = [];
      this.activeId = null;
      this.loading = false;
    },

    async retrieve() {
      this.loading = true;
      try {
        const cloud = useCloudWorkspaces();
        await cloud.fetchWorkspaces();
        const cloudList = (cloud.workspaces.value as Workspace[]).map((w) => ({
          id: w.id,
          name: w.name,
          role: w.role,
          ownerId: w.ownerId,
          storageUsedBytes: w.storageUsedBytes,
          createdAt: w.createdAt,
          emoji: w.emoji,
          color: w.color,
        }));
        // Local-only workspaces keep their registry entry when an account is
        // added, but the cloud list never mentions them. Without this merge the
        // local vault disappears from the switcher and its notes become
        // unreachable (only `cloudSync: false` rows qualify; cloud mirrors are
        // already in the cloud list or belong to another account). Signed out
        // there is no switcher and no account, so retrieve stays IPC-free.
        const { useAccountStore } = await import('@/store/account');
        const account = useAccountStore();
        // Same test as the store's `isAuthenticated` getter, which is typed out
        // of reach from this TS module.
        const authenticated = account.status === 'authenticated' && !!account.token;
        let localList: Array<Workspace> = [];
        let native = null;
        if (authenticated) {
          const local = (await listLocalWorkspaces().catch(
            () => [],
          )) as Array<{ id: string; name: string; cloudSync?: boolean }>;
          const cloudIds = new Set(cloudList.map((w) => w.id));
          localList = (local || [])
            .filter((w) => w.cloudSync === false && !cloudIds.has(w.id))
            .map((w) => ({
              id: w.id,
              name: w.name,
              local: true,
              ...readLocalDecorations()[w.id],
            }));
          native = await getActiveLocalWorkspace().catch(() => null);
        }
        this.workspaces = [...cloudList, ...localList];
        if (native?.id) {
          this.activeId = native.id;
        } else if (cloud.activeId.value) {
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
      return ws;
    },

    async switchTo(id: string) {
      if (id === this.activeId) return;
      // The full switch: pool swap, account state, live re-init and a fresh
      // sync identity. A bare workspace swap left the Rust scheduler stopped
      // and the account pinned to the old workspace (F40).
      const [{ switchAccount }, { getActiveAccountId }] = await Promise.all([
        import('@/composable/useAccountAuth'),
        import('@/lib/accounts-index'),
      ]);
      await switchAccount({ accountId: getActiveAccountId(), workspaceId: id });
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
