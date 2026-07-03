import { defineStore } from 'pinia';
import { ref } from 'vue';

const MAX_STACK = 50;

export const useUndoStore = defineStore('undo', () => {
  const stack = [];
  const _batchStack = [];
  let _batch = null;
  const lastAction = ref(null);

  function push(action) {
    if (_batch) {
      _batch.push(action);
      return;
    }
    stack.push(action);
    if (stack.length > MAX_STACK) stack.shift();
    lastAction.value = action;
  }

  function startBatch() {
    _batchStack.push(_batch);
    _batch = [];
  }

  function commitBatch() {
    const actions = _batch || [];
    _batch = _batchStack.pop() ?? null;
    if (actions.length) {
      const merged = mergeActions(actions);
      push(merged);
    }
  }

  function cancelBatch() {
    _batch = _batchStack.pop() ?? null;
  }

  function clearLastAction() {
    lastAction.value = null;
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

  return { push, undo, stack, lastAction, clearLastAction, startBatch, commitBatch, cancelBatch };
});

function mergeActions(actions) {
  if (actions.length === 1) return actions[0];

  const result = { notes: [], folders: [], items: [] };
  let type = actions[0]?.type;

  for (const a of actions) {
    if (a.notes) result.notes.push(...a.notes);
    if (a.folders) result.folders.push(...a.folders);
    if (a.items) result.items.push(...a.items);
  }

  return { ...result, type };
}
