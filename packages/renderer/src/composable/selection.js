// src/composables/selection.js
import { ref, computed } from 'vue';

export function useSelection() {
  const selectedItems = ref(new Set());
  const lastSelectedItem = ref(null);
  const isSelecting = ref(false);
  const selectionStart = ref({ x: 0, y: 0 });
  const selectionEnd = ref({ x: 0, y: 0 });

  const selectionBoxStyle = computed(() => {
    const left = Math.min(selectionStart.value.x, selectionEnd.value.x);
    const top = Math.min(selectionStart.value.y, selectionEnd.value.y);
    const width = Math.abs(selectionEnd.value.x - selectionStart.value.x);
    const height = Math.abs(selectionEnd.value.y - selectionStart.value.y);

    return {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
    };
  });

  function clearSelection() {
    selectedItems.value.clear();
    lastSelectedItem.value = null;
  }

  function toggleItemSelection(itemKey) {
    if (selectedItems.value.has(itemKey)) {
      selectedItems.value.delete(itemKey);
      if (lastSelectedItem.value === itemKey) {
        lastSelectedItem.value =
          selectedItems.value.size > 0
            ? Array.from(selectedItems.value)[0]
            : null;
      }
    } else {
      selectedItems.value.add(itemKey);
      lastSelectedItem.value = itemKey;
    }
  }

  function selectRange(start, end, getAllVisibleItems) {
    const allItems = getAllVisibleItems();
    const startIndex = allItems.indexOf(start);
    const endIndex = allItems.indexOf(end);

    if (startIndex !== -1 && endIndex !== -1) {
      const min = Math.min(startIndex, endIndex);
      const max = Math.max(startIndex, endIndex);
      for (let i = min; i <= max; i++) {
        selectedItems.value.add(allItems[i]);
      }
    }
  }

  function handleItemClick(event, type, id, getAllVisibleItems) {
    if (isSelecting.value) return event.preventDefault();

    const itemKey = `${type}-${id}`;
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    const isCtrlCmd = isMac ? event.metaKey : event.ctrlKey;

    if (isCtrlCmd) {
      toggleItemSelection(itemKey);
    } else if (event.shiftKey && lastSelectedItem.value) {
      event.preventDefault();
      selectRange(lastSelectedItem.value, itemKey, getAllVisibleItems);
    } else {
      selectedItems.value.clear();
      selectedItems.value.add(itemKey);
      lastSelectedItem.value = itemKey;
    }

    event.preventDefault();
    event.stopPropagation();
  }

  return {
    selectedItems,
    lastSelectedItem,
    isSelecting,
    selectionStart,
    selectionEnd,
    selectionBoxStyle,
    clearSelection,
    toggleItemSelection,
    selectRange,
    handleItemClick,
  };
}
