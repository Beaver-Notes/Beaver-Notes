import { nanoid } from 'nanoid';
import { defineStore } from 'pinia';

import { useUndoStore } from './undo';
import type { BulkDeleteItem, NoteRef, FolderRef } from './undo';
import {
  syncFolder,
  removeFolder,
} from '@/lib/yjs/workspace-doc';

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
  _childrenIndex: Map<string | null, Set<string>> | null;
}


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
    // _childrenIndex holds the children index (Map). Null until first access.
    // We store it as plain state so actions can mutate it directly;
    // Vue won't deeply observe the Map internals.
    _childrenIndex: null,
  }),

  getters: {
    // Lazily build the children index; Pinia caches this getter until
    // data/_childrenIndex changes so it only rebuilds when truly necessary.
    _index(state) {
      if (!state._childrenIndex) state._childrenIndex = buildChildIndex(state.data);
      return state._childrenIndex;
    },

    folders: (state) => Object.values(state.data).filter(({ id }) => id),

    getById: (state) => (id: string) => state.data[id],

    getByParent: (state) => (parentId: string | null = null) => {
      const ci = state._childrenIndex ?? buildChildIndex(state.data);
      const ids = ci.get(parentId ?? null) ?? new Set();
      return [...ids].map((id: string) => state.data[id]).filter(Boolean) as FolderData[];
    },

    rootFolders: (state) => {
      const ci = state._childrenIndex ?? buildChildIndex(state.data);
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
      const ci = state._childrenIndex ?? buildChildIndex(state.data);
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
      const ci = state._childrenIndex ?? buildChildIndex(state.data);
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
      const ci = state._childrenIndex ?? buildChildIndex(state.data);
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
      Object.values(state.data).filter((folder) => folder.id),

    archivedFolders: (state) =>
      Object.values(state.data).filter(
        (folder) => folder.id && folder.isArchived
      ),

    exists: (state) => (id: string) => !!state.data[id],
  },

  actions: {

    _rebuildIndex() {
      this._childrenIndex = buildChildIndex(this.data);
    },


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
      const acc = { items: [] as BulkDeleteItem[], notes: [] as NoteRef[], folders: [] as FolderRef[] };
      const { targetFolderId, affectedFolders } = await this._deleteSubtree(id, options, acc);

      useUndoStore().push({
        type: 'bulk-delete',
        items: acc.items,
        notes: acc.notes,
        folders: acc.folders,
      });

      return { deletedFolderId: id, targetFolderId, affectedFolders };
    },

    async _deleteSubtree(
      id: string,
      options: { moveContentsToParent?: boolean; moveContentsTo?: string | null; deleteContents?: boolean },
      acc: { items: BulkDeleteItem[]; notes: NoteRef[]; folders: FolderRef[] }
    ): Promise<{ targetFolderId: string | null; affectedFolders: string[] }> {
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
      const { useNoteStore, setSkipUndo } = await import('./note');
      const noteStore = useNoteStore();
      const noteIds = Object.values(noteStore.data)
        .filter((n) => n?.id && n.folderId === id)
        .map((n) => n.id);

      // Re-add the folder itself on undo (pushed first so children can reference it)
      acc.items.push({ type: 'folder', data: JSON.parse(JSON.stringify(folderToDelete)) });

      if (deleteContents) {
        setSkipUndo(true);
        try {
          for (const noteId of noteIds) {
            const snapshot = JSON.parse(JSON.stringify(noteStore.data[noteId]));
            await noteStore.delete(noteId);
            acc.items.push({ type: 'note', data: snapshot });
          }
        } finally {
          setSkipUndo(false);
        }
      } else {
        for (const noteId of noteIds) {
          await noteStore.update(noteId, { folderId: targetFolderId });
          acc.notes.push({ id: noteId, prevFolderId: id });
        }
      }

      const childIds = [...(this._index.get(id) ?? new Set())];
      for (const childId of childIds) {
        if (deleteContents) {
          await this._deleteSubtree(childId, { deleteContents: true }, acc);
        } else {
          const childPrevParent = this.data[childId]?.parentId;
          undoStore.startBatch();
          await this.update(childId, { parentId: targetFolderId });
          undoStore.cancelBatch();
          acc.folders.push({ id: childId, prevParentId: childPrevParent });
        }
      }

      indexRemove(this._index, folderToDelete);
      delete this.data[id];

      removeFolder(id);

      return { targetFolderId, affectedFolders: childIds };
    },


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
          (note) => note.id && note.folderId && allIdsSet.has(note.folderId)
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
          (note) => note.id && note.folderId && allIdsSet.has(note.folderId)
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

    // deletedIds tombstones removed — Yjs folder delete is the tombstone.
    cleanupDeletedIds(_days = 30): string[] {
      return [];
    },

    async createFolderPath(
      pathArray: string[],
      parentId: string | null = null
    ): Promise<{ folders: FolderData[]; createdIds: Set<string> }> {
      let currentParentId = parentId;
      const createdFolders: FolderData[] = [];
      const createdIds = new Set<string>();

      for (const folderName of pathArray) {
        const childIds = this._index.get(currentParentId ?? null) ?? new Set();
        let folder: FolderData | undefined;
        for (const cid of childIds) {
          if (this.data[cid]?.name === folderName) {
            folder = this.data[cid];
            break;
          }
        }

        if (!folder) {
          folder = await this.add({
            name: folderName,
            parentId: currentParentId,
          });
          createdIds.add(folder.id);
        }

        createdFolders.push(folder);
        currentParentId = folder.id;
      }

      return { folders: createdFolders, createdIds };
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
