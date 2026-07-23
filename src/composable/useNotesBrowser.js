import {
  computed,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  shallowRef,
  watch,
} from 'vue';
import Mousetrap from '@/lib/mousetrap';
import emitter from 'tiny-emitter/instance';
import KeyboardNavigation from '@/utils/ui/keyboardNavigation.js';
import { parseItemId, areSetsEqual } from '@/utils/helpers/index.js';
import { useSelection, patchSelectionSet } from '@/composable/selection';
import { useDragAndDrop } from '@/composable/dragAndDrop';
import { useUndoStore } from '@/store/undo';
import { useNotesBrowserTouch } from '@/composable/useNotesBrowserTouch';

export function useNotesBrowser({
  state = reactive({
    query: '',
    activeLabel: '',
    sortBy: 'createdAt',
    sortOrder: 'asc',
  }),
  route,
  router,
  noteStore,
  folderStore,
  dialog,
  translations,
  notes,
  folders,
  enableFilterPulse = false,
  listenForLabelEvents = false,
}) {
  const undoStack = useUndoStore();
  const keyboardNavigation = shallowRef(null);
  const suppressNextClick = ref(false);
  const isSorting = ref(false);
  const isFiltering = ref(false);
  const isSortMotionEnabled = ref(false);
  const showMoveModal = ref(false);

  const baseSelection = ref(new Set());
  const cachedItems = [];
  let dragAccumulated = null;
  let cachedScrollY = 0;
  let rafId = null;
  let pendingPointer = null;
  let mouseMoveListener = null;
  let sortTimer = null;
  let filterTimer = null;
  let lastReflowAtDelta = 0;

  const SCROLL_ZONE_SIZE = 80;
  const SCROLL_SPEED = 5;

  const {
    selectedItems,
    isSelecting,
    selectionStart,
    selectionEnd,
    selectionBoxStyle,
    handleItemClick,
    selectionMode,
    enterSelectionMode,
    clearSelection,
    selectAllItems,
  } = useSelection({ suppressNextClick });

  const {
    dragOverFolderId,
    handleNoteDragStart,
    handleFolderDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    startTouchDrag,
    updateTouchDrag,
    finishTouchDrag,
    cancelTouchDrag,
  } = useDragAndDrop({ selectedItems, clearSelection });

  const {
    handleItemTouchStart,
    handleItemTouchMove,
    handleItemTouchEnd,
    handleItemTouchCancel,
    cleanupTouch,
  } = useNotesBrowserTouch({
    selectionMode,
    selectedItems,
    enterSelectionMode,
    clearSelection,
    suppressNextClick,
    startTouchDrag,
    updateTouchDrag,
    finishTouchDrag,
    cancelTouchDrag,
  });

  const _selectedParsed = computed(() => {
    const notes = [];
    const folders = [];
    for (const key of selectedItems.value) {
      const { type, id } = parseItemId(key);
      if (type === 'note' && id) {
        const note = noteStore.getById(id);
        if (note) notes.push(note);
      } else if (type === 'folder' && id) {
        const folder = folderStore.getById(id);
        if (folder) folders.push(folder);
      }
    }
    return { notes, folders };
  });

  const selectedNotes = computed(() => _selectedParsed.value.notes);
  const selectedFolders = computed(() => _selectedParsed.value.folders);

  const moveMode = computed(() => {
    if (selectedNotes.value.length > 0 && selectedFolders.value.length > 0) {
      return null;
    }
    if (selectedNotes.value.length > 0) return 'note';
    if (selectedFolders.value.length > 0) return 'folder';
    return null;
  });

  function cacheItemRects() {
    cachedItems.length = 0;
    const nodes = document.querySelectorAll('[data-item-id]');
    nodes.forEach((el) => {
      const id = el.getAttribute('data-item-id');
      const rect = el.getBoundingClientRect();
      cachedItems.push({
        id,
        rect: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        },
      });
    });
    cachedScrollY = window.scrollY || document.documentElement.scrollTop || 0;
  }

  function handleMouseDown(event) {
    if (event.button !== 0) return;
    if (event.target.closest('[data-item-id]')) return;

    event.preventDefault();

    cacheItemRects();
    isSelecting.value = true;
    selectionStart.value = { x: event.clientX, y: event.clientY };
    selectionEnd.value = { x: event.clientX, y: event.clientY };

    if (!event.ctrlKey && !event.metaKey) {
      selectedItems.value = new Set();
    }

    baseSelection.value = new Set(selectedItems.value);
    dragAccumulated = new Set(baseSelection.value);
    mouseMoveListener = handleMouseMove;
    document.addEventListener('mousemove', mouseMoveListener);
  }

  function handleMouseMove(event) {
    if (!isSelecting.value) return;
    event.preventDefault();
    pendingPointer = { x: event.clientX, y: event.clientY };
    if (rafId === null) rafId = requestAnimationFrame(tickSelection);
  }

  function tickSelection() {
    const viewportHeight = window.innerHeight;
    let deltaY = 0;
    if (pendingPointer.y < SCROLL_ZONE_SIZE) deltaY = -SCROLL_SPEED;
    else if (pendingPointer.y > viewportHeight - SCROLL_ZONE_SIZE) {
      deltaY = SCROLL_SPEED;
    }

    if (deltaY !== 0) window.scrollBy(0, deltaY);

    selectionEnd.value = pendingPointer;

    const currentDelta =
      (window.scrollY || document.documentElement.scrollTop || 0) -
      cachedScrollY;

    if (Math.abs(currentDelta - lastReflowAtDelta) >= 64) {
      cacheItemRects();
      lastReflowAtDelta = currentDelta;
    }

    updateSelection();
    if (isSelecting.value) {
      rafId = requestAnimationFrame(tickSelection);
    } else {
      rafId = null;
    }
  }

  function updateSelection() {
    const left = Math.min(selectionStart.value.x, selectionEnd.value.x);
    const top = Math.min(selectionStart.value.y, selectionEnd.value.y);
    const right = Math.max(selectionStart.value.x, selectionEnd.value.x);
    const bottom = Math.max(selectionStart.value.y, selectionEnd.value.y);

    const scrollDelta =
      (window.scrollY || document.documentElement.scrollTop || 0) -
      cachedScrollY;

    dragAccumulated = new Set(baseSelection.value);

    let detectedType = null;
    for (const { id, rect } of cachedItems) {
      const adjustedTop = rect.top - scrollDelta;
      const adjustedBottom = rect.bottom - scrollDelta;

      const isIntersecting = !(
        rect.right < left ||
        rect.left > right ||
        adjustedBottom < top ||
        adjustedTop > bottom
      );
      if (!isIntersecting) continue;

      const [type] = id.split('-');
      if (!detectedType) detectedType = type;
      if (type === detectedType) {
        dragAccumulated.add(id);
      }
    }

    if (!areSetsEqual(dragAccumulated, selectedItems.value)) {
      patchSelectionSet(selectedItems.value, dragAccumulated);
    }
  }

  function handleMouseUp(event) {
    if (!isSelecting.value) return;

    const dx = Math.abs(selectionEnd.value.x - selectionStart.value.x);
    const dy = Math.abs(selectionEnd.value.y - selectionStart.value.y);

    if (dx >= 5 || dy >= 5) {
      suppressNextClick.value = true;
      event.preventDefault();
      event.stopPropagation();
    }

    isSelecting.value = false;
    dragAccumulated = null;

    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    if (mouseMoveListener) {
      document.removeEventListener('mousemove', mouseMoveListener);
      mouseMoveListener = null;
    }
  }

  function handleGridClick(event) {
    if (suppressNextClick.value) {
      suppressNextClick.value = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (event.target === event.currentTarget && !isSelecting.value) {
      clearSelection();
    }
  }

  function handleDocumentSelectionBoundary(event) {
    if (!selectionMode.value) return;

    const target = event.target;
    if (!(target instanceof Element)) return;
    if (
      target.closest('[data-item-id]') ||
      target.closest('[data-selection-keep]')
    ) {
      return;
    }

    clearSelection();
  }

  function getAllVisibleItems() {
    const items = [];
    folders.value.all.forEach((folder) => items.push(`folder-${folder.id}`));
    ['bookmarked', 'all', 'archived'].forEach((category) => {
      if (notes.value[category]) {
        notes.value[category].forEach((note) => items.push(`note-${note.id}`));
      }
    });
    return items;
  }

  function selectAll() {
    selectAllItems(getAllVisibleItems);
  }

  function bulkDelete() {
    const items = Array.from(selectedItems.value);
    const count = items.length;
    const title =
      count === 1
        ? translations.value.card.deleteItem
        : translations.value.card.deleteItems.replace('{count}', count);

    dialog.confirm({
      title,
      body: translations.value.card?.deleteAction || 'This action cannot be undone',
      icon: 'riDeleteBin6Line',
      okVariant: 'danger',
      okText: translations.value.card.delete,
      cancelText: translations.value.dialog.cancel,
      onConfirm: async () => {
        undoStack.startBatch();
        for (const item of items) {
          const { type, id } = parseItemId(item);
          if (type === 'note') {
            await noteStore.delete(id);
          } else if (type === 'folder') {
            await folderStore.delete(id);
          }
        }
        undoStack.commitBatch();
        clearSelection();
      },
    });
  }

  function bulkMove() {
    if (selectedItems.value.size > 0) {
      showMoveModal.value = true;
    }
  }

  function handleMoved(result) {
    const targetFolderId = result.folderId;

    undoStack.startBatch();
    for (const item of selectedItems.value) {
      const { type, id } = parseItemId(item);
      if (type === 'note') {
        const note = noteStore.getById(id);
        if (note) {
          noteStore.moveToFolder([id], targetFolderId);
        }
      } else if (type === 'folder') {
        const folder = folderStore.data[id];
        if (folder && !folderStore.wouldCreateCircularReference(id, targetFolderId)) {
          folderStore.update(id, { parentId: targetFolderId });
        }
      }
    }
    undoStack.commitBatch();

    clearSelection();
    showMoveModal.value = false;
  }

  watch(
    () => route.query.label,
    (label) => {
      if (label) {
        state.activeLabel = decodeURIComponent(label);
      }
    },
    { immediate: true }
  );

  watch(
    () => [state.sortBy, state.sortOrder],
    ([sortBy, sortOrder]) => {
      localStorage.setItem('sort-notes', JSON.stringify({ sortBy, sortOrder }));

      if (!isSortMotionEnabled.value) return;

      clearTimeout(sortTimer);
      isSorting.value = true;
      sortTimer = setTimeout(() => {
        isSorting.value = false;
      }, 400);
    }
  );

  if (enableFilterPulse) {
    watch(
      () => state.query,
      (value) => {
        clearTimeout(filterTimer);

        if (!value) {
          isFiltering.value = false;
          return;
        }

        isFiltering.value = true;
        filterTimer = setTimeout(() => {
          isFiltering.value = false;
        }, 250);
      }
    );
  }

  watch(notes, () => {
    setTimeout(() => {
      keyboardNavigation.value?.refresh();
    }, 250);
  });

  onMounted(() => {
    window.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('click', handleDocumentSelectionBoundary, true);

    const sortState = JSON.parse(localStorage.getItem('sort-notes'));
    if (sortState) Object.assign(state, sortState);
    isSortMotionEnabled.value = true;

    keyboardNavigation.value = new KeyboardNavigation({
      itemSelector: '.note-card',
      activeClass: 'ring-1 ring-primary active-note',
      breakpoints: {
        default: 1,
        '(min-width: 768px)': 2,
        '(min-width: 1024px)': 3,
        '(min-width: 1280px)': 4,
      },
    });

    keyboardNavigation.value.on('keydown', ({ event: { key }, activeItem }) => {
      const noteId = activeItem?.getAttribute('note-id');
      if (!noteId) return;

      if (key === 'Enter') {
        router.push(`/note/${noteId}`);
      } else if (['Backspace', 'Delete'].includes(key)) {
        const note = noteStore.getById(noteId);
        if (!note) return;
        dialog.confirm({
          title: translations.value.card.confirmPrompt,
          body: translations.value.card?.deleteAction || 'This action cannot be undone',
          icon: 'riDeleteBin6Line',
          okVariant: 'danger',
          okText: translations.value.card.confirm,
          cancelText: translations.value.dialog.cancel,
          onConfirm: async () => {
            await noteStore.delete(noteId);
          },
        });
      }
    });

    if (listenForLabelEvents) {
      emitter.on('set-label', (name) => {
        state.activeLabel = name;
      });
    }

    Mousetrap.bind(['del', 'backspace'], (event) => {
      if (selectedItems.value.size > 0) {
        event.preventDefault();
        bulkDelete();
      }
    });

    Mousetrap.bind(['command+z', 'ctrl+z'], async (event) => {
      event.preventDefault();
      await undoStack.undo();
    });

    Mousetrap.bind(['command+a', 'ctrl+a'], (event) => {
      event.preventDefault();
      selectAll();
    });

    Mousetrap.bind('esc', (event) => {
      if (selectedItems.value.size > 0) {
        event.preventDefault();
        clearSelection();
      }
    });
  });

  onUnmounted(() => {
    keyboardNavigation.value?.destroy();
    window.removeEventListener('mouseup', handleMouseUp);
    document.removeEventListener(
      'click',
      handleDocumentSelectionBoundary,
      true
    );
    clearTimeout(sortTimer);
    clearTimeout(filterTimer);
    cleanupTouch();
    if (listenForLabelEvents) {
      emitter.off('set-label');
    }
    Mousetrap.reset();
    if (mouseMoveListener) {
      document.removeEventListener('mousemove', mouseMoveListener);
      mouseMoveListener = null;
    }
  });

  return {
    state,
    selectedItems,
    selectedNotes,
    selectedFolders,
    selectionMode,
    isSelecting,
    selectionBoxStyle,
    isSorting,
    isFiltering,
    showMoveModal,
    moveMode,
    dragOverFolderId,
    clearSelection,
    selectAll,
    bulkDelete,
    bulkMove,
    handleMoved,
    getAllVisibleItems,
    handleItemClick,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleGridClick,
    handleItemTouchStart,
    handleItemTouchMove,
    handleItemTouchEnd,
    handleItemTouchCancel,
    handleNoteDragStart,
    handleFolderDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
