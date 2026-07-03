import { triggerSelectionHaptic } from '@/lib/native/haptics';

const LONG_PRESS_MS = 360;
const TOUCH_CANCEL_DISTANCE = 10;
const TOUCH_DRAG_DISTANCE = 8;

export function useNotesBrowserTouch({
  selectionMode,
  selectedItems,
  enterSelectionMode,
  clearSelection,
  suppressNextClick,
  startTouchDrag,
  updateTouchDrag,
  finishTouchDrag,
  cancelTouchDrag,
}) {
  let longPressTimer = null;
  let touchStartPoint = null;
  let touchPressItem = null;
  let touchLongPressTriggered = false;
  let touchDragStarted = false;

  function getTouchPoint(event) {
    return event.touches?.[0] || event.changedTouches?.[0] || null;
  }

  function resetTouchInteraction() {
    clearTimeout(longPressTimer);
    longPressTimer = null;
    touchStartPoint = null;
    touchPressItem = null;
    touchLongPressTriggered = false;
    touchDragStarted = false;
  }

  function touchDistanceFromStart(touch) {
    if (!touch || !touchStartPoint) return 0;
    return Math.hypot(
      touch.clientX - touchStartPoint.x,
      touch.clientY - touchStartPoint.y
    );
  }

  function handleItemTouchStart(event, type, id) {
    const touch = getTouchPoint(event);
    if (!touch) return;

    resetTouchInteraction();
    touchPressItem = { type, id, key: `${type}-${id}` };
    touchStartPoint = { x: touch.clientX, y: touch.clientY };

    longPressTimer = setTimeout(() => {
      touchLongPressTriggered = true;
      suppressNextClick.value = true;

      if (
        !selectionMode.value ||
        !selectedItems.value.has(touchPressItem.key)
      ) {
        enterSelectionMode(touchPressItem.key);
      } else {
        triggerSelectionHaptic();
      }
    }, LONG_PRESS_MS);
  }

  function handleItemTouchMove(event) {
    const touch = getTouchPoint(event);
    if (!touchPressItem || !touch) return;

    const distance = touchDistanceFromStart(touch);

    if (!touchLongPressTriggered) {
      if (distance > TOUCH_CANCEL_DISTANCE) {
        resetTouchInteraction();
      }
      return;
    }

    if (!touchDragStarted && distance >= TOUCH_DRAG_DISTANCE) {
      const sourceElement = document.querySelector(
        `[data-item-id="${touchPressItem.key}"]`
      );
      if (sourceElement) {
        startTouchDrag(
          touchPressItem.type,
          touchPressItem.id,
          touch,
          sourceElement
        );
        touchDragStarted = true;
      }
    }

    if (touchDragStarted) {
      event.preventDefault();
      updateTouchDrag(touch);
    }
  }

  function handleItemTouchEnd(event, type, id) {
    const itemKey = `${type}-${id}`;
    if (touchPressItem?.key !== itemKey) return;

    clearTimeout(longPressTimer);
    longPressTimer = null;

    if (touchDragStarted) {
      event.preventDefault();
      const didMove = finishTouchDrag();
      if (didMove) clearSelection();
      resetTouchInteraction();
      return;
    }

    if (touchLongPressTriggered) {
      event.preventDefault();
      resetTouchInteraction();
    }
  }

  function handleItemTouchCancel() {
    if (touchDragStarted) {
      cancelTouchDrag();
    }
    resetTouchInteraction();
  }

  function cleanupTouch() {
    clearTimeout(longPressTimer);
  }

  return {
    handleItemTouchStart,
    handleItemTouchMove,
    handleItemTouchEnd,
    handleItemTouchCancel,
    cleanupTouch,
  };
}
