import { defineStore } from 'pinia';

const MAX_STACK = 50;

export const useUndoStore = defineStore('undo', () => {
  const stack = [];

  function push(action) {
    stack.push(action);
    if (stack.length > MAX_STACK) stack.shift();
  }

  async function undo() {
    const action = stack.pop();
    if (!action) return;

    const noteStore = (await import('@/store/note')).useNoteStore();
    const folderStore = (await import('@/store/folder')).useFolderStore();

    switch (action.type) {
      case 'bulk-delete': {
        for (const item of action.items) {
          if (item.type === 'note') {
            item.data.isLocked = false;
            await noteStore.add(item.data);
          } else if (item.type === 'folder') {
            try { await folderStore.add(item.data); } catch {}
          }
        }
        break;
      }
      case 'toggle-bookmark': {
        for (const { id, prev } of action.notes) {
          await noteStore.update(id, { isBookmarked: prev });
        }
        break;
      }
      case 'toggle-archive': {
        for (const { id, prev } of action.notes) {
          await noteStore.update(id, { isArchived: prev });
        }
        for (const { id, prev } of action.folders) {
          if (prev) {
            await folderStore.unarchive(id);
          } else {
            await folderStore.archive(id);
          }
        }
        break;
      }
      case 'move': {
        for (const { id, prevFolderId } of action.notes) {
          await noteStore.update(id, { folderId: prevFolderId });
        }
        for (const { id, prevParentId } of action.folders) {
          await folderStore.update(id, { parentId: prevParentId });
        }
        break;
      }
    }
  }

  return { push, undo, stack };
});
