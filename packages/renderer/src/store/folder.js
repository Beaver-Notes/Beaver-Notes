import { nanoid } from 'nanoid';
import { defineStore } from 'pinia';
import { useStorage } from '../composable/storage.js';
import { trackChange } from '@/utils/sync.js';

const storage = useStorage();

export const useFolderStore = defineStore('folder', {
  state: () => ({
    data: {},
    deletedIds: {},
  }),

  getters: {
    folders: (state) => Object.values(state.data).filter(({ id }) => id),

    getById: (state) => (id) => state.data[id],

    getByParent:
      (state) =>
      (parentId = null) => {
        return Object.values(state.data).filter(
          (folder) => folder.parentId === parentId && folder.id
        );
      },

    rootFolders: (state) => {
      return Object.values(state.data).filter(
        (folder) => !folder.parentId && folder.id
      );
    },

    getFolderPath: (state) => (folderId) => {
      if (!folderId || !state.data[folderId]) return [];

      const path = [];
      let currentFolder = state.data[folderId];

      while (currentFolder) {
        path.unshift(currentFolder);
        currentFolder = currentFolder.parentId
          ? state.data[currentFolder.parentId]
          : null;
      }

      return path;
    },

    getDescendants: (state) => (folderId) => {
      const descendants = [];
      const queue = [folderId];

      while (queue.length > 0) {
        const currentId = queue.shift();
        const children = Object.values(state.data).filter(
          (f) => f.parentId === currentId
        );

        for (const child of children) {
          descendants.push(child);
          queue.push(child.id);
        }
      }

      return descendants;
    },

    hasChildren: (state) => (folderId) => {
      return Object.values(state.data).some(
        (folder) => folder.parentId === folderId
      );
    },

    getFolderDepth: (state) => (folderId) => {
      if (!folderId || !state.data[folderId]) return 0;

      let depth = 0;
      let currentFolder = state.data[folderId];

      while (currentFolder && currentFolder.parentId) {
        depth++;
        currentFolder = state.data[currentFolder.parentId];
      }

      return depth;
    },

    getFolderTree:
      (state) =>
      (parentId = null) => {
        const folders = Object.values(state.data)
          .filter((folder) => folder.parentId === parentId && folder.id)
          .sort((a, b) => a.name.localeCompare(b.name));

        return folders.map((folder) => ({
          ...folder,
          children: state.getFolderTree(folder.id),
          hasChildren: Object.values(state.data).some(
            (f) => f.parentId === folder.id
          ),
        }));
      },

    validFolders: (state) => {
      return Object.values(state.data).filter(
        (folder) => folder.id && !state.deletedIds[folder.id]
      );
    },
  },

  actions: {
    async retrieve() {
      try {
        const piniaData = this.data;
        const localStorageData = await storage.get('folders', {});
        this.data = { ...piniaData, ...localStorageData };

        const deletedIds = await storage.get('deletedFolderIds', {});
        this.deletedIds = deletedIds;

        return this.data;
      } catch (error) {
        console.error('Error retrieving folders:', error);
        throw error;
      }
    },

    async add(folder = {}) {
      try {
        const id = folder.id || nanoid();
        const newFolder = {
          id,
          name: folder.name || 'New Folder',
          parentId: folder.parentId || null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          color: folder.color || null,
          isExpanded:
            folder.isExpanded !== undefined ? folder.isExpanded : true,
          icon: folder.icon || '',
          sortOrder: folder.sortOrder || 0,
          ...folder,
        };

        if (newFolder.parentId && !this.data[newFolder.parentId]) {
          throw new Error('Parent folder does not exist');
        }

        this.data[id] = newFolder;

        await storage.set('folders', this.data);
        await trackChange(`folders.${id}`, this.data[id]);

        return this.data[id];
      } catch (error) {
        console.error('Error adding folder:', error);
        throw error;
      }
    },

    async update(id, data = {}) {
      try {
        if (!this.data[id]) {
          throw new Error('Folder not found');
        }

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

        this.data[id] = {
          ...this.data[id],
          ...data,
          updatedAt: Date.now(),
        };

        await storage.set('folders', this.data);
        await trackChange(`folders.${id}`, this.data[id]);

        return this.data[id];
      } catch (error) {
        console.error('Error updating folder:', error);
        throw error;
      }
    },

    async delete(id, options = {}) {
      try {
        if (!this.data[id]) {
          throw new Error('Folder not found');
        }

        const {
          moveContentsToParent = false,
          moveContentsTo = null,
          deleteContents = false,
        } = options;

        const folderToDelete = this.data[id];
        const targetFolderId =
          moveContentsTo ||
          (moveContentsToParent ? folderToDelete.parentId : null);

        const childFolders = Object.values(this.data).filter(
          (f) => f.parentId === id
        );
        for (const childFolder of childFolders) {
          if (deleteContents) {
            await this.delete(childFolder.id, { deleteContents: true });
          } else {
            await this.update(childFolder.id, { parentId: targetFolderId });
          }
        }

        this.deletedIds = this.deletedIds || {};
        this.deletedIds[id] = Date.now();

        delete this.data[id];

        await storage.set('folders', this.data);
        await storage.set('deletedFolderIds', this.deletedIds);
        await trackChange(`folders.${id}`, null);
        await trackChange('deletedFolderIds', this.deletedIds);

        return {
          deletedFolderId: id,
          targetFolderId,
          affectedFolders: childFolders.map((f) => f.id),
        };
      } catch (error) {
        console.error('Error deleting folder:', error);
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

      let currentParent = this.data[targetParentId];
      while (currentParent) {
        if (currentParent.id === folderId) return true;
        currentParent = currentParent.parentId
          ? this.data[currentParent.parentId]
          : null;
      }

      return false;
    },
    cleanupDeletedIds(days = 30) {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const toDelete = [];

      for (const [id, timestamp] of Object.entries(this.deletedIds || {})) {
        if (timestamp < cutoff) {
          toDelete.push(id);
        }
      }

      for (const id of toDelete) {
        delete this.deletedIds[id];
      }

      storage.set('deletedFolderIds', this.deletedIds);
      trackChange('deletedFolderIds', this.deletedIds);

      return toDelete;
    },

    async createFolderPath(pathArray, parentId = null) {
      let currentParentId = parentId;
      const createdFolders = [];

      for (const folderName of pathArray) {
        let existingFolder = Object.values(this.data).find(
          (f) => f.name === folderName && f.parentId === currentParentId
        );

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

    exists: (state) => (id) => {
      return !!state.data[id] && !state.deletedIds[id];
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
