// src/composables/selection.js
import { ref, computed } from 'vue';

/**
 * Detects whether the user is on macOS.
 * Uses the modern userAgentData API where available, falling back to userAgent.
 * Evaluated once at module load — avoids repeated string parsing on every click.
 */
const isMac = (() => {
  if (navigator.userAgentData?.platform) {
    return navigator.userAgentData.platform === 'macOS';
  }
  return /mac/i.test(navigator.userAgent);
})();

/**
 * Patches `target` in-place so it mirrors `source`, making the minimum number
 * of mutations.  Used by the drag-selection rAF loop: we avoid replacing the
 * Set reference on every frame (which would trigger full-tree re-renders) and
 * instead mutate only the changed entries, then let the caller decide when to
 * signal Vue that the ref changed.
 */
export function patchSelectionSet(target, source) {
  for (const v of target) if (!source.has(v)) target.delete(v);
  for (const v of source) if (!target.has(v)) target.add(v);
}

export function useSelection({ suppressNextClick } = {}) {
  const selectedItems = ref(new Set());
  const lastSelectedItem = ref(null);
  const isSelecting = ref(false);
  const selectionStart = ref({ x: 0, y: 0 });
  const selectionEnd = ref({ x: 0, y: 0 });

  const selectionBoxStyle = computed(() => {
    // Use document-relative coordinates (clientY + scrollY) so the box is
    // positioned with `position: absolute` on a body-level portal element.
    // This avoids the `position: fixed` bug where ancestors with
    // `will-change: transform`, `isolation: isolate`, or `overflow: clip`
    // (all present on .route-stage / .route-stage__page) create a new
    // containing block and make `fixed` act like `absolute` relative to them.
    const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
    const scrollX = window.scrollX || document.documentElement.scrollLeft || 0;

    const x1 = selectionStart.value.x + scrollX;
    const y1 = selectionStart.value.y + scrollY;
    const x2 = selectionEnd.value.x + scrollX;
    const y2 = selectionEnd.value.y + scrollY;

    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);

    return {
      position: 'absolute',
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
    };
  });

  /**
   * Replace the Set reference so Vue's reactivity detects the change and
   * re-evaluates every computed/watcher that depends on `selectedItems`.
   */
  function clearSelection() {
    selectedItems.value = new Set();
    lastSelectedItem.value = null;
  }

  function toggleItemSelection(itemKey) {
    // Copy-on-write: replace the ref so Vue fires change notifications.
    const next = new Set(selectedItems.value);
    if (next.has(itemKey)) {
      next.delete(itemKey);
      if (lastSelectedItem.value === itemKey) {
        lastSelectedItem.value =
          next.size > 0 ? next.values().next().value : null;
      }
    } else {
      next.add(itemKey);
      lastSelectedItem.value = itemKey;
    }
    selectedItems.value = next;
  }

  function selectRange(start, end, getAllVisibleItems) {
    const allItems = getAllVisibleItems();
    const spatialRange = getSpatialRange(start, end, allItems);
    if (!spatialRange.length) return;

    const next = new Set(selectedItems.value);
    for (const item of spatialRange) next.add(item);
    selectedItems.value = next;
  }

  function handleItemClick(event, type, id, getAllVisibleItems) {
    if (suppressNextClick?.value) return event.preventDefault();
    if (isSelecting.value) return event.preventDefault();

    const itemKey = `${type}-${id}`;
    const isCtrlCmd = isMac ? event.metaKey : event.ctrlKey;

    if (isCtrlCmd) {
      toggleItemSelection(itemKey);
      event.preventDefault();
      event.stopPropagation();
    } else if (event.shiftKey && lastSelectedItem.value) {
      event.preventDefault();
      selectRange(lastSelectedItem.value, itemKey, getAllVisibleItems);
      lastSelectedItem.value = itemKey;
      event.stopPropagation();
    } else {
      clearSelection();
      selectedItems.value.add(itemKey);
      lastSelectedItem.value = itemKey;
    }
  }

  function selectAllItems(getAllVisibleItems) {
    const allItems = getAllVisibleItems();
    selectedItems.value = new Set(allItems);
    lastSelectedItem.value = allItems.length
      ? allItems[allItems.length - 1]
      : null;
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
    selectAllItems,
    selectRange,
    handleItemClick,
  };
}

function getSpatialRange(start, end, allItems) {
  const visualItems = getVisualItems();
  if (!visualItems.length) return getLinearRange(start, end, allItems);

  const startVisual = visualItems.find((item) => item.id === start);
  const endVisual = visualItems.find((item) => item.id === end);
  if (!startVisual || !endVisual) {
    return getLinearRange(start, end, allItems);
  }

  const rowTolerance = Math.max(
    8,
    Math.min(startVisual.rect.height, endVisual.rect.height) * 0.5
  );
  const columnTolerance = Math.max(
    8,
    Math.min(startVisual.rect.width, endVisual.rect.width) * 0.5
  );

  const sameRow =
    Math.abs(startVisual.centerY - endVisual.centerY) <= rowTolerance;
  if (sameRow) {
    const minX = Math.min(startVisual.centerX, endVisual.centerX);
    const maxX = Math.max(startVisual.centerX, endVisual.centerX);
    const rowCenterY = (startVisual.centerY + endVisual.centerY) / 2;
    return visualItems
      .filter(
        (item) =>
          Math.abs(item.centerY - rowCenterY) <= rowTolerance &&
          item.centerX >= minX &&
          item.centerX <= maxX
      )
      .map((item) => item.id);
  }

  const sameColumn =
    Math.abs(startVisual.centerX - endVisual.centerX) <= columnTolerance;
  if (sameColumn) {
    const minY = Math.min(startVisual.centerY, endVisual.centerY);
    const maxY = Math.max(startVisual.centerY, endVisual.centerY);
    const columnCenterX = (startVisual.centerX + endVisual.centerX) / 2;
    return visualItems
      .filter(
        (item) =>
          Math.abs(item.centerX - columnCenterX) <= columnTolerance &&
          item.centerY >= minY &&
          item.centerY <= maxY
      )
      .map((item) => item.id);
  }

  return getLinearRange(
    start,
    end,
    visualItems.map((item) => item.id)
  );
}

function getLinearRange(start, end, allItems) {
  const startIndex = allItems.indexOf(start);
  const endIndex = allItems.indexOf(end);
  if (startIndex === -1 || endIndex === -1) return [];

  const min = Math.min(startIndex, endIndex);
  const max = Math.max(startIndex, endIndex);
  return allItems.slice(min, max + 1);
}

function getVisualItems() {
  return Array.from(document.querySelectorAll('[data-item-id]'))
    .map((element) => {
      const id = element.getAttribute('data-item-id');
      if (!id) return null;

      const rect = element.getBoundingClientRect();
      return {
        id,
        rect,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
      };
    })
    .filter(Boolean);
}
