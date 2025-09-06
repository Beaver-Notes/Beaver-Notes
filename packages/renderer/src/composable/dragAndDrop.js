// src/composables/dragAndDrop.js
import { ref } from 'vue';
import { useFolderStore } from '@/store/folder';
import {
  createFullSizeCardGhost,
  createAnimatedStackGhost,
} from '@/composable/ghost.js';

export function useDragAndDrop({ selectedItems }) {
  const dragOverFolderId = ref(null);
  const draggedNoteId = ref(null);
  const draggedFolderId = ref(null);
  const dragType = ref(null);

  function handleNoteDragStart(event, noteId) {
    const itemKey = `note-${noteId}`;
    if (!selectedItems.value.has(itemKey)) {
      selectedItems.value.clear();
      selectedItems.value.add(itemKey);
    }

    const selectedNoteIds = Array.from(selectedItems.value)
      .filter((i) => i.startsWith('note-'))
      .map((i) => i.replace(/^note-/, ''));

    const selectedElements = selectedNoteIds
      .map((id) => document.querySelector(`[data-item-id="note-${id}"]`))
      .filter(Boolean);

    let ghost;
    if (selectedElements.length > 1) {
      ghost = createAnimatedStackGhost(selectedElements);
    } else {
      ghost = createFullSizeCardGhost(
        event.target.closest('[data-item-id]'),
        selectedElements.length
      );
    }

    const ghostRect = ghost.getBoundingClientRect();
    event.dataTransfer.setDragImage(
      ghost,
      ghostRect.width / 2,
      ghostRect.height / 2
    );

    event.dataTransfer.setData(
      'application/json',
      JSON.stringify({
        type: selectedNoteIds.length > 1 ? 'notes' : 'note',
        id: noteId,
        ids: selectedNoteIds,
      })
    );

    draggedNoteId.value = noteId;
    dragType.value = 'note';
    event.dataTransfer.effectAllowed = 'move';

    setTimeout(() => ghost.parentNode && document.body.removeChild(ghost), 100);
  }

  function handleFolderDragStart(event, folderId) {
    const itemKey = `folder-${folderId}`;
    if (!selectedItems.value.has(itemKey)) {
      selectedItems.value.clear();
      selectedItems.value.add(itemKey);
    }

    const selectedFolderIds = Array.from(selectedItems.value)
      .filter((i) => i.startsWith('folder-'))
      .map((i) => i.replace(/^folder-/, ''));

    const selectedElements = selectedFolderIds
      .map((id) => document.querySelector(`[data-item-id="folder-${id}"]`))
      .filter(Boolean);

    let ghost;
    if (selectedElements.length > 1) {
      ghost = createAnimatedStackGhost(selectedElements);
    } else {
      ghost = createFullSizeCardGhost(
        event.target.closest('[data-item-id]'),
        selectedElements.length
      );
    }

    const ghostRect = ghost.getBoundingClientRect();
    event.dataTransfer.setDragImage(
      ghost,
      ghostRect.width / 2,
      ghostRect.height / 2
    );

    event.dataTransfer.setData(
      'application/json',
      JSON.stringify({
        type: selectedFolderIds.length > 1 ? 'folders' : 'folder',
        id: folderId,
        ids: selectedFolderIds,
      })
    );

    draggedFolderId.value = folderId;
    dragType.value = 'folder';
    event.dataTransfer.effectAllowed = 'move';

    setTimeout(() => ghost.parentNode && document.body.removeChild(ghost), 100);
  }

  function handleDragEnd() {
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
    handleDragOver,
    handleDragLeave,
    dragType,
    handleNoteDragStart,
    handleFolderDragStart,
    handleDragEnd,
  };
}
