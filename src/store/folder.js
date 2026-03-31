import { nanoid } from 'nanoid';
import { defineStore } from 'pinia';
import { useStorage } from '../composable/storage.js';
import { trackChange } from '@/utils/sync';

const storage = useStorage();

// ─── Deleted-IDs auto-cleanup ─────────────────────────────────────────────────

const DELETED_IDS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function pruneDeletedIds(deletedIds) {
  const cutoff = Date.now() - DELETED_IDS_TTL_MS;
  let dirty = false;
  for (const id of Object.keys(deletedIds)) {
    if (deletedIds[id] < cutoff) {
      delete deletedIds[id];
      dirty = true;
    }
  }
  return dirty;
}

// ─── Children index helpers ───────────────────────────────────────────────────
//
// Instead of scanning Object.values(state.data) on every getter call we keep a
// Map<parentId | null, Set<id>> that is updated on every mutation.
// All "find children of X" queries go from O(N) to O(1).

function buildChildIndex(data) {
  const index = new Map();
  for (const folder of Object.values(data)) {
    if (!folder.id) continue;
    const key = folder.parentId ?? null;
    if (!index.has(key)) index.set(key, new Set());
    index.get(key).add(folder.id);
  }
  return index;
}

function indexAdd(index, folder) {
  const key = folder.parentId ?? null;
  if (!index.has(key)) index.set(key, new Set());
  index.get(key).add(folder.id);
}

function indexRemove(index, folder) {
  const key = folder.parentId ?? null;
  index.get(key)?.delete(folder.id);
}

function indexMove(index, folder, oldParentId) {
  const oldKey = oldParentId ?? null;
  index.get(oldKey)?.delete(folder.id);
  const newKey = folder.parentId ?? null;
  if (!index.has(newKey)) index.set(newKey, new Set());
  index.get(newKey).add(folder.id);
}

export const useFolderStore = defineStore('folder', {
  state: () => ({
    data: {},
    deletedIds: {},
    // _ci holds the children index (Map). Null until first access.
    // We store it as plain state so actions can mutate it directly;
    // Vue won't deeply observe the Map internals.
    _ci: null,
  }),

  getters: {
    // Lazily build the children index; Pinia caches this getter until
    // data/_ci changes so it only rebuilds when truly necessary.
    _index(state) {
      if (!state._ci) state._ci = buildChildIndex(state.data);
      return state._ci;
    },

    folders: (state) => Object.values(state.data).filter(({ id }) => id),

    getById: (state) => (id) => state.data[id],

    getByParent() {
      return (parentId = null) => {
        const ids = this._index.get(parentId ?? null) ?? new Set();
        return [...ids].map((id) => this.data[id]).filter(Boolean);
      };
    },

    rootFolders() {
      const ids = this._index.get(null) ?? new Set();
      return [...ids].map((id) => this.data[id]).filter(Boolean);
    },

    getFolderPath: (state) => (folderId) => {
      if (!folderId || !state.data[folderId]) return [];
      const path = [];
      let current = state.data[folderId];
      while (current) {
        path.unshift(current);
        current = current.parentId ? state.data[current.parentId] : null;
      }
      return path;
    },

    getDescendants() {
      return (folderId) => {
        const descendants = [];
        const queue = [folderId];
        while (queue.length > 0) {
          const currentId = queue.shift();
          const childIds = this._index.get(currentId) ?? new Set();
          for (const childId of childIds) {
            const child = this.data[childId];
            if (child) {
              descendants.push(child);
              queue.push(childId);
            }
          }
        }
        return descendants;
      };
    },

    hasChildren() {
      return (folderId) => {
        const children = this._index.get(folderId);
        return children ? children.size > 0 : false;
      };
    },

    getFolderDepth: (state) => (folderId) => {
      if (!folderId || !state.data[folderId]) return 0;
      let depth = 0;
      let current = state.data[folderId];
      while (current && current.parentId) {
        depth++;
        current = state.data[current.parentId];
      }
      return depth;
    },

    // Builds the folder tree using the O(1) children index. The self-reference
    // via `this` (a Pinia getter auto-binding) lets us recurse without
    // re-entering the getter loop.
    getFolderTree() {
      const buildTree = (parentId = null) => {
        const childIds = this._index.get(parentId ?? null) ?? new Set();
        return [...childIds]
          .map((id) => this.data[id])
          .filter(Boolean)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((folder) => ({
            ...folder,
            children: buildTree(folder.id),
            hasChildren: (this._index.get(folder.id)?.size ?? 0) > 0,
          }));
      };
      return buildTree;
    },

    validFolders: (state) =>
      Object.values(state.data).filter(
        (folder) => folder.id && !state.deletedIds[folder.id]
      ),

    exists: (state) => (id) => !!state.data[id] && !state.deletedIds[id],
  },

  actions: {
    // ── Index maintenance ─────────────────────────────────────────────────

    _rebuildIndex() {
      this._ci = buildChildIndex(this.data);
    },

    // ── Load & hydration ──────────────────────────────────────────────────

    async retrieve() {
      try {
        const localStorageData = await storage.get('folders', {});
        this.data = { ...this.data, ...localStorageData };

        const deletedIds = await storage.get('deletedFolderIds', {});
        // Prune stale entries on every load — keeps the object from growing forever
        if (pruneDeletedIds(deletedIds)) {
          await storage.set('deletedFolderIds', deletedIds);
        }
        this.deletedIds = deletedIds;

        this._rebuildIndex();
        return this.data;
      } catch (error) {
        console.error('Error retrieving folders:', error);
        throw error;
      }
    },

    // ── CRUD ──────────────────────────────────────────────────────────────

    async add(folder = {}) {
      try {
        const id = folder.id || nanoid();
        const newFolder = {
          id,
          name: folder.name || '',
          parentId: folder.parentId || null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          color: folder.color || null,
          isExpanded: folder.isExpanded !== undefined ? folder.isExpanded : true,
          icon: folder.icon || '',
          sortOrder: folder.sortOrder || 0,
          ...folder,
        };

        if (newFolder.parentId && !this.data[newFolder.parentId]) {
          throw new Error('Parent folder does not exist');
        }

        this.data[id] = newFolder;
        indexAdd(this._index, newFolder);

        // Surgical write: save only the new folder row, not the entire folders object
        await storage.set(`folders.${id}`, newFolder);
        await trackChange(`folders.${id}`, newFolder);

        return this.data[id];
      } catch (error) {
        console.error('Error adding folder:', error);
        throw error;
      }
    },

    async update(id, data = {}) {
      try {
        if (!this.data[id]) throw new Error('Folder not found');

        if (
          data.parentId !== undefined &&
          data.parentId !== this.data[id].parentId
        ) {
          if (this.wouldCreateCircularReference(id, data.parentId)) {
            throw new Error('Cannot move folder: would create circular reference');
          }
        }

        const oldParentId = this.data[id].parentId;
        this.data[id] = { ...this.data[id], ...data, updatedAt: Date.now() };

        // Keep index in sync when parentId changes
        if (data.parentId !== undefined && data.parentId !== oldParentId) {
          indexMove(this._index, this.data[id], oldParentId);
        }

        await storage.set(`folders.${id}`, this.data[id]);
        await trackChange(`folders.${id}`, this.data[id]);

        return this.data[id];
      } catch (error) {
        console.error('Error updating folder:', error);
        throw error;
      }
    },

    async delete(id, options = {}) {
      try {
        if (!this.data[id]) throw new Error('Folder not found');

        const {
          moveContentsToParent = false,
          moveContentsTo = null,
          deleteContents = false,
        } = options;

        const folderToDelete = this.data[id];
        const targetFolderId =
          moveContentsTo ||
          (moveContentsToParent ? folderToDelete.parentId : null);

        // O(1) child lookup via index — no Object.values scan
        const childIds = [...(this._index.get(id) ?? new Set())];
        for (const childId of childIds) {
          if (deleteContents) {
            await this.delete(childId, { deleteContents: true });
          } else {
            await this.update(childId, { parentId: targetFolderId });
          }
        }

        indexRemove(this._index, folderToDelete);
        this.deletedIds[id] = Date.now();
        delete this.data[id];

        await storage.delete(`folders.${id}`);
        await storage.set('deletedFolderIds', this.deletedIds);
        await trackChange(`folders.${id}`, null);
        await trackChange('deletedFolderIds', this.deletedIds);

        return {
          deletedFolderId: id,
          targetFolderId,
          affectedFolders: childIds,
        };
      } catch (error) {
        console.error('Error deleting folder:', error);
        throw error;
      }
    },

    async move(folderId, newParentId) {
      try {
        if (this.wouldCreateCircularReference(folderId, newParentId)) {
          throw new Error('Cannot move folder: would create circular reference');
        }
        return await this.update(folderId, { parentId: newParentId });
      } catch (error) {
        console.error('Error moving folder:', error);
        throw error;
      }
    },

    wouldCreateCircularReference(folderId, targetParentId) {
      if (!targetParentId) return false;
      if (folderId === targetParentId) return true;
      let current = this.data[targetParentId];
      while (current) {
        if (current.id === folderId) return true;
        current = current.parentId ? this.data[current.parentId] : null;
      }
      return false;
    },

    cleanupDeletedIds(days = 30) {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const toDelete = [];
      for (const [id, timestamp] of Object.entries(this.deletedIds || {})) {
        if (timestamp < cutoff) toDelete.push(id);
      }
      for (const id of toDelete) delete this.deletedIds[id];
      storage.set('deletedFolderIds', this.deletedIds);
      trackChange('deletedFolderIds', this.deletedIds);
      return toDelete;
    },

    async createFolderPath(pathArray, parentId = null) {
      let currentParentId = parentId;
      const createdFolders = [];

      for (const folderName of pathArray) {
        // O(1) via index instead of Object.values().find()
        const childIds = this._index.get(currentParentId ?? null) ?? new Set();
        let existingFolder = null;
        for (const cid of childIds) {
          if (this.data[cid]?.name === folderName) {
            existingFolder = this.data[cid];
            break;
          }
        }

        if (!existingFolder) {
          existingFolder = await this.add({ name: folderName, parentId: currentParentId });
        }

        createdFolders.push(existingFolder);
        currentParentId = existingFolder.id;
      }

      return createdFolders;
    },

    async getFolderStats(folderId) {
      const descendants = this.getDescendants(folderId);
      return {
        subfolderCount: descendants.length,
        depth: this.getFolderDepth(folderId),
        hasChildren: this.hasChildren(folderId),
      };
    },
  },
});
