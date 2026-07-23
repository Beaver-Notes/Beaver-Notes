import { nanoid } from 'nanoid';
import { defineStore } from 'pinia';

import { useUndoStore } from './undo';
import {
  syncFolder,
  removeFolder,
  syncDeletedFolderIds,
} from '@/composable/useWorkspaceYjs';

import { collectExpiredIds } from '@/utils/helpers/index.js';

interface FolderData {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
  color: string | null;
  isExpanded: boolean;
  isArchived: boolean;
  icon: string;
  sortOrder: number;
  [key: string]: unknown;
}

interface FolderState {
  data: Record<string, FolderData>;
  deletedIds: Record<string, number>;
  _ci: Map<string | null, Set<string>> | null;
}

// Children index helpers

function buildChildIndex(data: Record<string, FolderData>): Map<string | null, Set<string>> {
  const index = new Map<string | null, Set<string>>();
  for (const folder of Object.values(data)) {
    if (!folder.id) continue;
    const key = folder.parentId ?? null;
    if (!index.has(key)) index.set(key, new Set());
    index.get(key)!.add(folder.id);
  }
  return index;
}

function indexAdd(index: Map<string | null, Set<string>>, folder: FolderData): void {
  const key = folder.parentId ?? null;
  if (!index.has(key)) index.set(key, new Set());
  index.get(key)!.add(folder.id);
}

function indexRemove(index: Map<string | null, Set<string>>, folder: FolderData): void {
  const key = folder.parentId ?? null;
  index.get(key)?.delete(folder.id);
}

function indexMove(index: Map<string | null, Set<string>>, folder: FolderData, oldParentId: string | undefined | null): void {
  const oldKey = oldParentId ?? null;
  index.get(oldKey)?.delete(folder.id);
  const newKey = folder.parentId ?? null;
  if (!index.has(newKey)) index.set(newKey, new Set());
  index.get(newKey)!.add(folder.id);
}

export const useFolderStore = defineStore('folder', {
  state: (): FolderState => ({
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

    getById: (state) => (id: string) => state.data[id],

    getByParent: (state) => (parentId: string | null = null) => {
      const ci = state._ci ?? buildChildIndex(state.data);
      const ids = ci.get(parentId ?? null) ?? new Set();
      return [...ids].map((id: string) => state.data[id]).filter(Boolean) as FolderData[];
    },

    rootFolders: (state) => {
      const ci = state._ci ?? buildChildIndex(state.data);
      const ids = ci.get(null) ?? new Set();
      return [...ids].map((id: string) => state.data[id]).filter(Boolean) as FolderData[];
    },

    getFolderPath: (state) => (folderId: string) => {
      if (!folderId || !state.data[folderId]) return [];
      const path: FolderData[] = [];
      let current: FolderData | undefined = state.data[folderId];
      while (current) {
        path.unshift(current);
        current = current.parentId ? state.data[current.parentId] : undefined;
      }
      return path;
    },

    getDescendants: (state) => {
      const ci = state._ci ?? buildChildIndex(state.data);
      return (folderId: string) => {
        const descendants: FolderData[] = [];
        const queue = [folderId];
        while (queue.length > 0) {
          const currentId = queue.shift()!;
          const childIds = ci.get(currentId) ?? new Set();
          for (const childId of childIds) {
            const child = state.data[childId];
            if (child) {
              descendants.push(child);
              queue.push(childId);
            }
          }
        }
        return descendants;
      };
    },

    hasChildren: (state) => {
      const ci = state._ci ?? buildChildIndex(state.data);
      return (folderId: string) => {
        const children = ci.get(folderId);
        return children ? children.size > 0 : false;
      };
    },

    getFolderDepth: (state) => (folderId: string) => {
      if (!folderId || !state.data[folderId]) return 0;
      let depth = 0;
      let current = state.data[folderId];
      while (current && current.parentId) {
        depth++;
        current = state.data[current.parentId];
      }
      return depth;
    },

    getFolderTree: (state) => {
      const ci = state._ci ?? buildChildIndex(state.data);
      const buildTree = (parentId: string | null = null): (FolderData & { children: FolderData[]; hasChildren: boolean })[] => {
        const childIds = ci.get(parentId ?? null) ?? new Set();
        return [...childIds]
          .map((id: string) => state.data[id])
          .filter((x): x is FolderData => !!x)
          .sort((a: FolderData, b: FolderData) => a.name.localeCompare(b.name))
          .map((folder: FolderData) => ({
            ...folder,
            children: buildTree(folder.id),
            hasChildren: (ci.get(folder.id)?.size ?? 0) > 0,
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

    exists: (state) => (id: string) => !!state.data[id] && !state.deletedIds[id],
  },

  actions: {
    // ── Index maintenance ─────────────────────────────────────────────────

    _rebuildIndex() {
      this._ci = buildChildIndex(this.data);
    },

    // ── Load & hydration ──────────────────────────────────────────────────

    async retrieve(): Promise<Record<string, FolderData>> {
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

    async add(folder: Partial<FolderData> = {}): Promise<FolderData> {
      try {
        const id = folder.id || nanoid();
        const newFolder: FolderData = {
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
        } as FolderData;

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

    async update(id: string, data: Partial<FolderData> = {}): Promise<FolderData> {
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

    async delete(id: string, options: { moveContentsToParent?: boolean; moveContentsTo?: string | null; deleteContents?: boolean } = {}): Promise<{ deletedFolderId: string; targetFolderId: string | null; affectedFolders: string[] }> {
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

    async archive(id: string): Promise<{ archivedFolderIds: string[] }> {
      try {
        if (!this.data[id]) throw new Error('Folder not found');

        const allIds = [id, ...this.getDescendants(id).map((f: FolderData) => f.id)];
        const allIdsSet = new Set(allIds);

        const undoStore = useUndoStore();
        undoStore.startBatch();

        const undoFolders = allIds.map((fid: string) => ({ id: fid, prev: false }));
        for (const folderId of allIds) {
          await this.update(folderId, { isArchived: true });
        }

        const { useNoteStore } = await import('./note');
        const noteStore = useNoteStore();
        const notesToArchive = Object.values(noteStore.data).filter(
          (note: any) => note.id && allIdsSet.has(note.folderId)
        );
        const undoNotes = notesToArchive.map((n: any) => ({ id: n.id, prev: false }));
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

    async unarchive(id: string): Promise<{ unarchivedFolderIds: string[] }> {
      try {
        if (!this.data[id]) throw new Error('Folder not found');

        const allIds = [id, ...this.getDescendants(id).map((f: FolderData) => f.id)];
        const allIdsSet = new Set(allIds);

        const undoStore = useUndoStore();
        undoStore.startBatch();

        const undoFolders = allIds.map((fid: string) => ({ id: fid, prev: true }));
        for (const folderId of allIds) {
          await this.update(folderId, { isArchived: false });
        }

        const { useNoteStore } = await import('./note');
        const noteStore = useNoteStore();
        const notesToUnarchive = Object.values(noteStore.data).filter(
          (note: any) => note.id && allIdsSet.has(note.folderId)
        );
        const undoNotes = notesToUnarchive.map((n: any) => ({ id: n.id, prev: true }));
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

    async move(folderId: string, newParentId: string | null): Promise<FolderData> {
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

    wouldCreateCircularReference(folderId: string, targetParentId: string | null | undefined): boolean {
      if (!targetParentId) return false;
      if (folderId === targetParentId) return true;
      let current: FolderData | undefined = this.data[targetParentId];
      while (current) {
        if (current.id === folderId) return true;
        current = current.parentId ? this.data[current.parentId] : undefined;
      }
      return false;
    },

    cleanupDeletedIds(days = 30): string[] {
      const toDelete = collectExpiredIds(this.deletedIds, days);
      for (const id of toDelete) delete this.deletedIds[id];
      syncDeletedFolderIds(this.deletedIds);
      return toDelete;
    },

    async createFolderPath(pathArray: string[], parentId: string | null = null): Promise<FolderData[]> {
      let currentParentId = parentId;
      const createdFolders: FolderData[] = [];

      for (const folderName of pathArray) {
        // O(1) via index instead of Object.values().find()
        const childIds = this._index.get(currentParentId ?? null) ?? new Set();
        let existingFolder: FolderData | undefined;
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

    async getFolderStats(folderId: string): Promise<{ subfolderCount: number; depth: number; hasChildren: boolean }> {
      const descendants = this.getDescendants(folderId);
      return {
        subfolderCount: descendants.length,
        depth: this.getFolderDepth(folderId),
        hasChildren: this.hasChildren(folderId),
      };
    },
  },
});
