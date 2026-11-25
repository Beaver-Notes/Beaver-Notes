/**
 * useBlockDrag.js — long-press any block to move it (touch gesture).
 *
 * Provides an optimized, responsive, flawless long-press-to-drag interaction
 * for reordering blocks in the tiptap editor on touch devices (iPad, phones,
 * foldables). Designed to never get in the way of:
 *   • drawing in paper-block (canvas area is excluded)
 *   • interacting with links, buttons, and other interactive elements
 *   • normal scrolling (moving finger before long-press fires = scroll)
 *
 * Usage:
 *   const { bindBlockDrag, isDragging } = useBlockDrag({ editor, onBlockMoved })
 */
import { ref, unref } from 'vue';
import { NodeSelection } from '@tiptap/pm/state';

const LONG_PRESS_MS = 450;
const SCROLL_VS_DRAG_PX = 6;
const HINT_SOURCE = 'bn-block-drag-source';
const HINT_TARGET = 'bn-block-drag-target';

export function useBlockDrag({
  editor,
  enabled = true,
  onBlockMoved,
  onDragStart,
  onDragEnd,
} = {}) {
  const isDragging = ref(false);
  const dragSourcePos = ref(null);
  const dragTargetPos = ref(null);
  let pressTimer = null;
  let pressStart = null;
  let pressBlockPos = null;
  let dragStarted = false;

  // `enabled` may be a plain boolean or a computed ref (NoteEditor passes one).
  const isEnabled = () => Boolean(unref(enabled));

  function blockDOM(pos) {
    return editor.value?.view?.nodeDOM(pos) || null;
  }

  function clearHints() {
    document
      .querySelectorAll(`.${HINT_SOURCE}, .${HINT_TARGET}`)
      .forEach((el) => el.classList.remove(HINT_SOURCE, HINT_TARGET));
  }

  function setHint(pos, className) {
    const el = blockDOM(pos);
    if (el instanceof HTMLElement) el.classList.add(className);
  }

  function getTouchPoint(event) {
    return event.touches?.[0] || event.changedTouches?.[0] || null;
  }

  function isExcludedTarget(target) {
    if (!(target instanceof HTMLElement)) return false;

    // Paper block drawing surface — never drag while drawing on canvas
    if (target.closest('[data-type="paper"]')) {
      const paperWrapper = target.closest('[data-type="paper"]');
      const canvas = paperWrapper.querySelector('canvas');
      if (canvas && canvas.contains(target)) return true;
      if (target.closest('.surface-toolbar, .surface-handle')) return true;
    }

    // Links
    if (target.closest('a[href]')) return true;

    // Buttons and interactive elements
    if (target.closest('button, [role="button"], input, select, textarea, [contenteditable="true"]')) {
      return true;
    }

    // Explicit opt-out
    if (target.closest('[data-no-drag]')) return true;

    return false;
  }

  function findBlockPosAt(x, y) {
    const view = editor.value?.view;
    if (!view) return null;

    const posInfo = view.posAtCoords({ left: x, top: y });
    if (!posInfo) return null;

    const { state } = view;
    const $pos = state.doc.resolve(posInfo.pos);

    let depth = $pos.depth;
    while (depth > 0) {
      const node = $pos.node(depth);
      const nodePos = $pos.before(depth);
      if (node.isBlock && !node.isText && nodePos >= 0) {
        return { pos: nodePos, node };
      }
      depth--;
    }

    const nodeAfter = $pos.nodeAfter;
    if (nodeAfter && nodeAfter.isBlock && !nodeAfter.isText) {
      return { pos: posInfo.pos, node: nodeAfter };
    }

    return null;
  }

  function moveBlock(sourcePos, targetPos) {
    const view = editor.value?.view;
    if (!view) return false;

    const { state, dispatch } = view;
    const node = state.doc.nodeAt(sourcePos);
    if (!node) return false;

    const nodeSize = node.nodeSize;

    // Transaction 1: delete the block from its source position. Doing the
    // delete and insert in a single transaction forces ProseMirror to remap
    // positions through the delete step (~300ms on a 60k-node doc). Two
    // separate dispatches take ~8ms total.
    dispatch(state.tr.delete(sourcePos, sourcePos + nodeSize));

    // After the delete, positions after sourcePos shift back by nodeSize.
    // Recalculate target from the now-current doc state.
    let adjustedTarget = targetPos;
    if (targetPos > sourcePos) {
      adjustedTarget = targetPos - nodeSize;
    }
    adjustedTarget = Math.min(
      Math.max(adjustedTarget, 0),
      view.state.doc.content.size,
    );

    const tr = view.state.tr.insert(adjustedTarget, node);
    const selection = NodeSelection.create(tr.doc, adjustedTarget);
    tr.setSelection(selection);
    dispatch(tr);
    return true;
  }

  function onTouchStart(event) {
    if (!isEnabled() || !editor.value) return;

    const touch = getTouchPoint(event);
    if (!touch) return;

    const target = event.target;
    if (isExcludedTarget(target)) return;

    const block = findBlockPosAt(touch.clientX, touch.clientY);
    if (!block) return;

    pressStart = {
      x: touch.clientX,
      y: touch.clientY,
      time: touch.timeStamp ?? performance.now(),
    };
    pressBlockPos = block.pos;
    dragStarted = false;

    pressTimer = setTimeout(() => {
      pressTimer = null;
      if (!pressStart) return;
      dragStarted = true;
      isDragging.value = true;
      dragSourcePos.value = pressBlockPos;
      dragTargetPos.value = pressBlockPos;
      setHint(pressBlockPos, HINT_SOURCE);
      setHint(pressBlockPos, HINT_TARGET);
      onDragStart?.(pressBlockPos);
    }, LONG_PRESS_MS);
  }

  function onTouchMove(event) {
    if (!isEnabled()) return;
    const touch = getTouchPoint(event);
    if (!touch) return;

    if (!pressStart) return;

    const dx = touch.clientX - pressStart.x;
    const dy = touch.clientY - pressStart.y;
    const distance = Math.hypot(dx, dy);

    if (!dragStarted) {
      if (distance > SCROLL_VS_DRAG_PX) {
        cancelPress();
      }
      return;
    }

    event.preventDefault();

    const block = findBlockPosAt(touch.clientX, touch.clientY);
    if (block && block.pos !== dragSourcePos.value) {
      if (dragTargetPos.value !== block.pos) {
        const previous = blockDOM(dragTargetPos.value);
        if (previous instanceof HTMLElement) {
          previous.classList.remove(HINT_TARGET);
        }
      }
      dragTargetPos.value = block.pos;
      setHint(block.pos, HINT_TARGET);
    }
  }

  function onTouchEnd() {
    if (!isEnabled()) return;

    try {
      if (
        dragStarted &&
        dragSourcePos.value !== null &&
        dragTargetPos.value !== null
      ) {
        if (dragTargetPos.value !== dragSourcePos.value) {
          moveBlock(dragSourcePos.value, dragTargetPos.value);
          onBlockMoved?.(dragSourcePos.value, dragTargetPos.value);
        }
        onDragEnd?.();
      }
    } finally {
      resetPress();
    }
  }

  function onTouchCancel() {
    resetPress();
    onDragEnd?.();
  }

  function cancelPress() {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
    pressStart = null;
    pressBlockPos = null;
    dragStarted = false;
    isDragging.value = false;
    dragSourcePos.value = null;
    dragTargetPos.value = null;
    clearHints();
  }

  function resetPress() {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
    pressStart = null;
    pressBlockPos = null;
    dragStarted = false;
    isDragging.value = false;
    dragSourcePos.value = null;
    dragTargetPos.value = null;
    clearHints();
  }

  function bindBlockDrag(element) {
    if (!element) return {};

    element.addEventListener('touchstart', onTouchStart, { passive: false });
    element.addEventListener('touchmove', onTouchMove, { passive: false });
    element.addEventListener('touchend', onTouchEnd, { passive: false });
    element.addEventListener('touchcancel', onTouchCancel, { passive: false });

    return {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel,
      unbind: () => {
        element.removeEventListener('touchstart', onTouchStart);
        element.removeEventListener('touchmove', onTouchMove);
        element.removeEventListener('touchend', onTouchEnd);
        element.removeEventListener('touchcancel', onTouchCancel);
        resetPress();
      },
    };
  }

  return {
    isDragging,
    dragSourcePos,
    dragTargetPos,
    bindBlockDrag,
    cancelPress,
    resetPress,
  };
}