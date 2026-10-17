import { defineStore } from 'pinia';
import { ref } from 'vue';

const MAX_STACK = 50;

export interface BulkDeleteItem {
  type: 'note' | 'folder';
  data: Record<string, unknown>;
}

export interface NoteRef {
  id: string;
  prev?: boolean;
  prevFolderId?: string | null;
}

export interface FolderRef {
  id: string;
  prev?: boolean;
  prevParentId?: string | null;
}

interface UndoAction {
  type: string;
  notes?: NoteRef[];
  folders?: FolderRef[];
  items?: BulkDeleteItem[];
}

export const useUndoStore = defineStore('undo', () => {
  const stack: UndoAction[] = [];
  const _batchStack: (UndoAction[] | null)[] = [];
  let _batch: UndoAction[] | null = null;
  const lastAction = ref<UndoAction | null>(null);

  function push(action: UndoAction) {
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
        startBatch();
        try {
          // folders before notes, and retry until parents exist (depth-order)
          const items = [...(action.items || [])];
          const folders = items.filter((i) => i.type === 'folder');
          const notes = items.filter((i) => i.type === 'note');
          // sort folders by parent depth (parents first) to restore hierarchy correctly
          const folderIds = new Set(folders.map((f) => f.data.id as string));
          let pending = [...folders];
          let progress = true;
          while (pending.length && progress) {
            progress = false;
            const next: BulkDeleteItem[] = [];
            for (const item of pending) {
              const parentId = (item.data.parentId as string | null) ?? null;
              if (parentId === null || !folderIds.has(parentId) || folderStore.getById(parentId)) {
                try {
                  await folderStore.add(item.data);
                } catch (error) {
                  console.warn('[undo] failed to restore folder', item.data.id, error);
                }
                progress = true;
              } else {
                next.push(item);
              }
            }
            pending = next;
          }
          // Fallback for leftovers (circular/missing parent): try anyway.
          for (const item of pending) {
            try {
              await folderStore.add({ ...item.data, parentId: null } as Record<string, unknown>);
            } catch (error) {
              console.warn('[undo] fallback restore failed', item.data.id, error);
            }
          }
          for (const item of notes) {
            item.data.isLocked = false;
            await noteStore.add(item.data);
          }

          for (const { id, prevFolderId } of action.notes ?? []) {
            await noteStore.update(id, { folderId: prevFolderId });
          }

          for (const { id, prevParentId } of action.folders ?? []) {
            await folderStore.update(id, { parentId: prevParentId });
          }
        } finally {
          cancelBatch();
        }
        break;
      }
      case 'toggle-bookmark': {
        startBatch();
        try {
          for (const { id, prev } of action.notes!) await noteStore.update(id, { isBookmarked: prev });
        } finally { cancelBatch(); }
        break;
      }
      case 'toggle-archive': {
        startBatch();
        try {
          for (const { id, prev } of action.notes!) await noteStore.update(id, { isArchived: prev });
          for (const { id, prev } of action.folders!) {
            if (prev) await folderStore.archive(id);
            else await folderStore.unarchive(id);
          }
        } finally { cancelBatch(); }
        break;
      }
      case 'move': {
        startBatch();
        try {
          for (const { id, prevFolderId } of action.notes!) await noteStore.update(id, { folderId: prevFolderId });
          for (const { id, prevParentId } of action.folders!) await folderStore.update(id, { parentId: prevParentId });
        } finally { cancelBatch(); }
        break;
      }
    }
  }

  return { push, undo, stack, lastAction, clearLastAction, startBatch, commitBatch, cancelBatch };
});

function mergeActions(actions: UndoAction[]): UndoAction {
  if (actions.length === 1) return actions[0];

  const result: { notes: NoteRef[]; folders: FolderRef[]; items: BulkDeleteItem[] } = { notes: [], folders: [], items: [] };
  let type = actions[0]?.type;

  for (const a of actions) {
    if (a.notes) result.notes.push(...a.notes);
    if (a.folders) result.folders.push(...a.folders);
    if (a.items) result.items.push(...a.items);
  }

  return { ...result, type };
}
