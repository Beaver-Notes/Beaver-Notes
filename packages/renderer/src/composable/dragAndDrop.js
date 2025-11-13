import { ref } from 'vue';
import { useFolderStore } from '@/store/folder';
import { createFullSizeCardGhost, createAnimatedStackGhost } from './ghost.js';

export function useDragAndDrop({ selectedItems }) {
  const dragOverFolderId = ref(null);
  const draggedNoteId = ref(null);
  const draggedFolderId = ref(null);
  const dragType = ref(null);
  const isDragging = ref(false);

  function getIdsForDrag(kind, id) {
    const key = `${kind}-${id}`;
    if (selectedItems.value.has(key)) {
      return Array.from(selectedItems.value)
        .filter((k) => k.startsWith(`${kind}-`))
        .map((k) => k.replace(new RegExp(`^${kind}-`), ''));
    }
    return [id];
  }

  function handleNoteDragStart(event, noteId) {
    isDragging.value = true;
    const noteIds = getIdsForDrag('note', noteId);

    const selectedElements = noteIds
      .map((id) => document.querySelector(`[data-item-id="note-${id}"]`))
      .filter(Boolean);

    const ghost =
      selectedElements.length > 1
        ? createAnimatedStackGhost(selectedElements)
        : createFullSizeCardGhost(
            event.target.closest('[data-item-id]'),
            selectedElements.length
          );

    const r = ghost.getBoundingClientRect();
    event.dataTransfer.setDragImage(ghost, r.width / 2, r.height / 2);
    event.dataTransfer.setData(
      'application/json',
      JSON.stringify({
        type: noteIds.length > 1 ? 'notes' : 'note',
        id: noteId,
        ids: noteIds,
      })
    );

    draggedNoteId.value = noteId;
    dragType.value = 'note';
    event.dataTransfer.effectAllowed = 'move';
    setTimeout(() => ghost.parentNode && document.body.removeChild(ghost), 100);
  }

  function handleFolderDragStart(event, folderId) {
    isDragging.value = true;
    const folderIds = getIdsForDrag('folder', folderId);

    const selectedElements = folderIds
      .map((id) => document.querySelector(`[data-item-id="folder-${id}"]`))
      .filter(Boolean);

    const ghost =
      selectedElements.length > 1
        ? createAnimatedStackGhost(selectedElements)
        : createFullSizeCardGhost(
            event.target.closest('[data-item-id]'),
            selectedElements.length
          );

    const r = ghost.getBoundingClientRect();
    event.dataTransfer.setDragImage(ghost, r.width / 2, r.height / 2);
    event.dataTransfer.setData(
      'application/json',
      JSON.stringify({
        type: folderIds.length > 1 ? 'folders' : 'folder',
        id: folderId,
        ids: folderIds,
      })
    );

    draggedFolderId.value = folderId;
    dragType.value = 'folder';
    event.dataTransfer.effectAllowed = 'move';
    setTimeout(() => ghost.parentNode && document.body.removeChild(ghost), 100);
  }

  function handleDragEnd() {
    isDragging.value = false;
    dragOverFolderId.value = null;
    draggedNoteId.value = null;
    draggedFolderId.value = null;
    dragType.value = null;
  }

  function handleDragOver(event, folderId) {
    event.preventDefault();
    const folderStore = useFolderStore();

    const dragData = event.dataTransfer.types.includes('application/json');
    if (!dragData) return;

    if (dragType.value === 'folder' && draggedFolderId.value) {
      if (
        folderStore.wouldCreateCircularReference(
          draggedFolderId.value,
          folderId
        )
      ) {
        event.dataTransfer.dropEffect = 'none';
        return;
      }
    }

    dragOverFolderId.value = folderId;
    event.dataTransfer.dropEffect = 'move';
  }

  function handleDragLeave(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      dragOverFolderId.value = null;
    }
  }

  return {
    dragOverFolderId,
    draggedNoteId,
    draggedFolderId,
    dragType,
    isDragging,
    handleNoteDragStart,
    handleFolderDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
  };
}
