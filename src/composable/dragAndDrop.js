import { ref } from 'vue';
import { useFolderStore } from '@/store/folder';
import { useNoteStore } from '@/store/note';
import { createFullSizeCardGhost, createAnimatedStackGhost } from './ghost.js';

export function useDragAndDrop({ selectedItems, clearSelection }) {
  const noteStore = useNoteStore();
  const folderStore = useFolderStore();
  const dragOverFolderId = ref(null);
  const draggedNoteId = ref(null);
  const draggedFolderId = ref(null);
  const dragType = ref(null);
  const isDragging = ref(false);
  const touchDragPayload = ref(null);

  let touchGhost = null;

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
    const sourceElement = document.querySelector(
      `[data-item-id="note-${noteId}"]`
    );
    sourceElement?.setAttribute('data-dragging', '');
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
    const sourceElement = document.querySelector(
      `[data-item-id="folder-${folderId}"]`
    );
    sourceElement?.setAttribute('data-dragging', '');
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
    document
      .querySelectorAll('[data-dragging]')
      .forEach((el) => el.removeAttribute('data-dragging'));
    isDragging.value = false;
    dragOverFolderId.value = null;
    draggedNoteId.value = null;
    draggedFolderId.value = null;
    dragType.value = null;
  }

  function handleDragOver(event, folderId) {
    event.preventDefault();

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

  function handleDrop(event, targetFolderId) {
    event.preventDefault();

    try {
      const dragData = JSON.parse(
        event.dataTransfer.getData('application/json')
      );
      const didMove = movePayloadToFolder(dragData, targetFolderId);
      if (didMove) {
        clearSelection?.();
      }
    } catch (error) {
      console.error('Error handling drop:', error);
    }

    handleDragEnd();
  }

  function movePayloadToFolder(payload, targetFolderId) {
    if (!payload || targetFolderId === undefined) return false;

    if (payload.type === 'notes' || payload.type === 'note') {
      const noteIds = payload.ids || [payload.id];
      noteIds.forEach((noteId) => {
        noteStore.update(noteId, { folderId: targetFolderId });
      });
      return true;
    }

    if (payload.type === 'folders' || payload.type === 'folder') {
      const folderIds = payload.ids || [payload.id];
      folderIds.forEach((folderId) => {
        if (
          !folderStore.wouldCreateCircularReference(folderId, targetFolderId)
        ) {
          folderStore.update(folderId, { parentId: targetFolderId });
        }
      });
      return true;
    }

    return false;
  }

  function createTouchPayload(kind, id) {
    const ids = getIdsForDrag(kind, id);
    return {
      type: ids.length > 1 ? `${kind}s` : kind,
      id,
      ids,
    };
  }

  function positionTouchGhost(touch) {
    if (!touchGhost) return;

    touchGhost.style.position = 'fixed';
    touchGhost.style.top = '0';
    touchGhost.style.left = '0';
    touchGhost.style.margin = '0';
    touchGhost.style.pointerEvents = 'none';
    touchGhost.style.transform = `translate(${touch.clientX + 14}px, ${
      touch.clientY + 14
    }px) scale(0.94)`;
  }

  function startTouchDrag(kind, id, touch, sourceElement) {
    isDragging.value = true;

    const payload = createTouchPayload(kind, id);
    touchDragPayload.value = payload;

    const selectedElements = payload.ids
      .map((itemId) =>
        document.querySelector(`[data-item-id="${kind}-${itemId}"]`)
      )
      .filter(Boolean);

    if (sourceElement) {
      sourceElement.setAttribute('data-dragging', '');
    }

    touchGhost =
      selectedElements.length > 1
        ? createAnimatedStackGhost(selectedElements)
        : createFullSizeCardGhost(sourceElement, selectedElements.length || 1);

    dragType.value = kind;
    if (kind === 'note') draggedNoteId.value = id;
    if (kind === 'folder') draggedFolderId.value = id;

    positionTouchGhost(touch);
  }

  function updateTouchDrag(touch) {
    if (!touchDragPayload.value) return;

    positionTouchGhost(touch);

    const target = document
      .elementFromPoint(touch.clientX, touch.clientY)
      ?.closest?.('[data-item-id^="folder-"]');
    const folderId =
      target?.getAttribute('data-item-id')?.replace(/^folder-/, '') || null;

    if (
      dragType.value === 'folder' &&
      draggedFolderId.value &&
      folderId &&
      folderStore.wouldCreateCircularReference(draggedFolderId.value, folderId)
    ) {
      dragOverFolderId.value = null;
      return;
    }

    dragOverFolderId.value = folderId;
  }

  function finishTouchDrag() {
    const payload = touchDragPayload.value;
    const targetFolderId = dragOverFolderId.value;

    destroyTouchDragGhost();
    touchDragPayload.value = null;

    if (payload && targetFolderId) {
      movePayloadToFolder(payload, targetFolderId);
    }

    handleDragEnd();
    return Boolean(payload && targetFolderId);
  }

  function destroyTouchDragGhost() {
    if (touchGhost?.parentNode) {
      touchGhost.parentNode.removeChild(touchGhost);
    }
    touchGhost = null;
  }

  function cancelTouchDrag() {
    destroyTouchDragGhost();
    touchDragPayload.value = null;
    handleDragEnd();
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
    handleDrop,
    movePayloadToFolder,
    startTouchDrag,
    updateTouchDrag,
    finishTouchDrag,
    cancelTouchDrag,
  };
}
