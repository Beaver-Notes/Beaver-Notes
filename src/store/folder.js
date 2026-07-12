import { nanoid } from 'nanoid';
import { defineStore } from 'pinia';

import { useUndoStore } from './undo';
import {
  syncFolder,
  removeFolder,
  syncDeletedFolderIds,
} from '@/composable/useWorkspaceYjs';

import { collectExpiredIds } from '@/utils/helpers/index.js';

// Children index helpers

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

    archivedFolders: (state) =>
      Object.values(state.data).filter(
        (folder) =>
          folder.id && !state.deletedIds[folder.id] && folder.isArchived
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
        // Data is already populated from the Yjs workspace doc via
        // writeStoresFromWorkspace().  No KV reads needed.
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
          isExpanded:
            folder.isExpanded !== undefined ? folder.isExpanded : true,
          isArchived: folder.isArchived || false,
          icon: folder.icon || '',
          sortOrder: folder.sortOrder || 0,
          ...folder,
        };

        if (newFolder.parentId && !this.data[newFolder.parentId]) {
          throw new Error('Parent folder does not exist');
        }

        this.data[id] = newFolder;
        indexAdd(this._index, newFolder);

        syncFolder(newFolder);

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
            throw new Error(
              'Cannot move folder: would create circular reference'
            );
          }
        }

        const oldParentId = this.data[id].parentId;
        this.data[id] = { ...this.data[id], ...data, updatedAt: Date.now() };

        // Keep index in sync when parentId changes
        if (data.parentId !== undefined && data.parentId !== oldParentId) {
          indexMove(this._index, this.data[id], oldParentId);
          useUndoStore().push({ type: 'move', notes: [], folders: [{ id, prevParentId: oldParentId }] });
        }

        syncFolder(this.data[id]);

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

        const undoStore = useUndoStore();
        undoStore.startBatch();

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

        removeFolder(id);
        syncDeletedFolderIds(this.deletedIds);

        const snapshot = JSON.parse(JSON.stringify(folderToDelete));
        undoStore.cancelBatch();
        undoStore.push({ type: 'bulk-delete', items: [{ type: 'folder', data: snapshot }] });

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

    // ── Archive / Unarchive ────────────────────────────────────────────

    async archive(id) {
      try {
        if (!this.data[id]) throw new Error('Folder not found');

        const allIds = [id, ...this.getDescendants(id).map((f) => f.id)];

        const undoStore = useUndoStore();
        undoStore.startBatch();

        const undoFolders = allIds.map((fid) => ({ id: fid, prev: false }));
        for (const folderId of allIds) {
          await this.update(folderId, { isArchived: true });
        }

        const { useNoteStore } = await import('./note');
        const noteStore = useNoteStore();
        const notesToArchive = Object.values(noteStore.data).filter(
          (note) => note.id && allIds.includes(note.folderId)
        );
        const undoNotes = notesToArchive.map((n) => ({ id: n.id, prev: false }));
        for (const note of notesToArchive) {
          await noteStore.update(note.id, { isArchived: true });
        }

        undoStore.cancelBatch();
        undoStore.push({ type: 'toggle-archive', notes: undoNotes, folders: undoFolders });

        return { archivedFolderIds: allIds };
      } catch (error) {
        console.error('Error archiving folder:', error);
        throw error;
      }
    },

    async unarchive(id) {
      try {
        if (!this.data[id]) throw new Error('Folder not found');

        const allIds = [id, ...this.getDescendants(id).map((f) => f.id)];

        const undoStore = useUndoStore();
        undoStore.startBatch();

        const undoFolders = allIds.map((fid) => ({ id: fid, prev: true }));
        for (const folderId of allIds) {
          await this.update(folderId, { isArchived: false });
        }

        const { useNoteStore } = await import('./note');
        const noteStore = useNoteStore();
        const notesToUnarchive = Object.values(noteStore.data).filter(
          (note) => note.id && allIds.includes(note.folderId)
        );
        const undoNotes = notesToUnarchive.map((n) => ({ id: n.id, prev: true }));
        for (const note of notesToUnarchive) {
          await noteStore.update(note.id, { isArchived: false });
        }

        undoStore.cancelBatch();
        undoStore.push({ type: 'toggle-archive', notes: undoNotes, folders: undoFolders });

        return { unarchivedFolderIds: allIds };
      } catch (error) {
        console.error('Error unarchiving folder:', error);
        throw error;
      }
    },

    async move(folderId, newParentId) {
      try {
        if (this.wouldCreateCircularReference(folderId, newParentId)) {
          throw new Error(
            'Cannot move folder: would create circular reference'
          );
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
      const toDelete = collectExpiredIds(this.deletedIds, days);
      for (const id of toDelete) delete this.deletedIds[id];
      syncDeletedFolderIds(this.deletedIds);
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
          existingFolder = await this.add({
            name: folderName,
            parentId: currentParentId,
          });
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
