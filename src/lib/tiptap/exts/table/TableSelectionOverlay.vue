<template>
  <Teleport to="body">
    <div v-if="isVisible && selectionRect" ref="floatingRef" :style="overlayStyle" style="pointer-events:none; z-index:40">
      <div
        :style="{
          width: selectionRect.width + 'px',
          height: selectionRect.height + 'px',
          border: '2px solid hsl(var(--twc-primary) / 0.5)',
          borderRadius: '3px',
          position: 'relative',
          pointerEvents: 'none',
          boxSizing: 'border-box',
        }"
      >
        <div
          v-for="h in cornerHandles"
          :key="h.id"
          :style="h.style"
          @mousedown.stop="startResize(h.id, $event)"
        />
      </div>
    </div>
  </Teleport>
</template>

<script>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { CellSelection, cellAround, columnResizingPluginKey } from '@tiptap/pm/tables';
import { computeVisibleRect, rectEq } from './tiptap-table-utils.js';

export default {
  props: { editor: { type: Object, default: null } },
  emits: ['cellMenuOpen'],
  setup(props, { emit }) {
    const selectionRect = ref(null);
    const isVisible = ref(false);
    const clipped = ref(false);
    const activeHandle = ref(null);
    const floatingRef = ref(null);
    let anchorCellPos = null;
    let rafId = null;
    let trackRafId = null;

    const overlayStyle = computed(() => {
      const r = selectionRect.value;
      if (!r) return {};
      return {
        position: 'fixed',
        left: r.left + 'px',
        top: r.top + 'px',
        width: r.width + 'px',
        height: r.height + 'px',
      };
    });

    function getSelectionRect() {
      if (!props.editor) return null;
      const { selection, doc } = props.editor.state;
      const view = props.editor.view;
      if (selection instanceof CellSelection) {
        const cells = [];
        selection.forEachCell((node, pos) => {
          const dom = view.nodeDOM(pos);
          if (dom) cells.push(dom);
        });
        if (!cells.length) return null;
        const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
        cells.forEach((el) => {
          const r = el.getBoundingClientRect();
          bounds.left = Math.min(bounds.left, r.left);
          bounds.top = Math.min(bounds.top, r.top);
          bounds.right = Math.max(bounds.right, r.right);
          bounds.bottom = Math.max(bounds.bottom, r.bottom);
        });
        return {
          rect: new DOMRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top),
          cells,
        };
      }
      const $anchor = selection.$anchor;
      const cell = cellAround($anchor);
      if (!cell) return null;
      const dom = view.nodeDOM(cell.pos);
      if (!dom) return null;
      const r = dom.getBoundingClientRect();
      return { rect: new DOMRect(r.left, r.top, r.width, r.height), cells: [dom] };
    }

    function updateOverlay() {
      const result = getSelectionRect();
      if (!result) {
        if (isVisible.value || selectionRect.value) {
          isVisible.value = false;
          selectionRect.value = null;
          clipped.value = false;
        }
        return;
      }
      const visible = computeVisibleRect(result.rect, result.cells[0]);
      if (visible && visible.width > 0 && visible.height > 0) {
        if (!rectEq(selectionRect.value, visible)) selectionRect.value = visible;
        clipped.value = !rectEq(result.rect, visible);
        isVisible.value = true;
      } else if (isVisible.value || selectionRect.value) {
        isVisible.value = false;
        selectionRect.value = null;
        clipped.value = false;
      }
    }

    const cornerHandles = computed(() => {
      const r = selectionRect.value;
      if (!r || clipped.value) return [];
      const size = 12;
      const half = size / 2;
      return [
        { id: 'tl', style: { position: 'absolute', left: r.width < 16 ? '0px' : `-${half}px`, top: r.height < 16 ? '0px' : `-${half}px`, width: size + 'px', height: size + 'px', cursor: 'nwse-resize', zIndex: 10, pointerEvents: 'auto', borderRadius: '50%', background: 'white', border: '2px solid hsl(var(--twc-primary) / 0.6)' } },
        { id: 'tr', style: { position: 'absolute', right: r.width < 16 ? '0px' : `-${half}px`, top: r.height < 16 ? '0px' : `-${half}px`, width: size + 'px', height: size + 'px', cursor: 'nesw-resize', zIndex: 10, pointerEvents: 'auto', borderRadius: '50%', background: 'white', border: '2px solid hsl(var(--twc-primary) / 0.6)' } },
        { id: 'bl', style: { position: 'absolute', left: r.width < 16 ? '0px' : `-${half}px`, bottom: r.height < 16 ? '0px' : `-${half}px`, width: size + 'px', height: size + 'px', cursor: 'nesw-resize', zIndex: 10, pointerEvents: 'auto', borderRadius: '50%', background: 'white', border: '2px solid hsl(var(--twc-primary) / 0.6)' } },
        { id: 'br', style: { position: 'absolute', right: r.width < 16 ? '0px' : `-${half}px`, bottom: r.height < 16 ? '0px' : `-${half}px`, width: size + 'px', height: size + 'px', cursor: 'nwse-resize', zIndex: 10, pointerEvents: 'auto', borderRadius: '50%', background: 'white', border: '2px solid hsl(var(--twc-primary) / 0.6)' } },
      ];
    });

    function startResize(handleId, event) {
      if (!props.editor) return;
      event.preventDefault();
      const { selection } = props.editor.state;
      let cellSel = selection instanceof CellSelection ? selection : null;
      if (!cellSel) {
        const cell = cellAround(selection.$anchor);
        if (cell) {
          try { cellSel = CellSelection.create(props.editor.state.doc, cell.pos, cell.pos); }
          catch { return; }
        }
      }
      if (!cellSel) return;

      const selRectResult = getSelectionRect();
      if (!selRectResult) return;
      const selRect = selRectResult.rect;
      const tolerance = 3;
      const corners = {};
      cellSel.forEachCell((node, pos) => {
        const dom = props.editor.view.nodeDOM(pos);
        if (!dom) return;
        const r = dom.getBoundingClientRect();
        if (Math.abs(r.left - selRect.left) < tolerance && Math.abs(r.top - selRect.top) < tolerance) corners.topLeft = pos;
        if (Math.abs(r.right - selRect.right) < tolerance && Math.abs(r.top - selRect.top) < tolerance) corners.topRight = pos;
        if (Math.abs(r.left - selRect.left) < tolerance && Math.abs(r.bottom - selRect.bottom) < tolerance) corners.bottomLeft = pos;
        if (Math.abs(r.right - selRect.right) < tolerance && Math.abs(r.bottom - selRect.bottom) < tolerance) corners.bottomRight = pos;
      });
      const anchorMap = { tl: 'bottomRight', tr: 'bottomLeft', bl: 'topRight', br: 'topLeft' };
      const anchorPos = corners[anchorMap[handleId]];
      if (!anchorPos) return;

      anchorCellPos = anchorPos;
      activeHandle.value = handleId;

      const onMouseMove = (e) => {
        if (!props.editor || anchorCellPos == null) return;
        const posData = props.editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
        if (!posData) return;
        const $pos = props.editor.state.doc.resolve(posData.pos);
        const cell = cellAround($pos);
        if (!cell) return;
        try {
          const newSel = CellSelection.create(props.editor.state.doc, anchorCellPos, cell.pos);
          props.editor.view.dispatch(props.editor.state.tr.setSelection(newSel));
        } catch { return; }
      };

      const onMouseUp = () => {
        anchorCellPos = null;
        activeHandle.value = null;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    }

    function startTracking() {
      if (trackRafId != null) return;
      const loop = () => {
        updateOverlay();
        trackRafId = requestAnimationFrame(loop);
      };
      trackRafId = requestAnimationFrame(loop);
    }

    function stopTracking() {
      if (trackRafId != null) {
        cancelAnimationFrame(trackRafId);
        trackRafId = null;
      }
    }

    function onSelectionUpdate() {
      updateOverlay();
    }

    function onTransaction(payload) {
      const tr = payload?.transaction || payload;
      if (!tr || !tr.getMeta) return;
      const meta = tr.getMeta(columnResizingPluginKey);
      if (meta && meta.setDragging != null) { startRAF(); }
      if (meta && meta.setDragging == null) { stopRAF(); updateOverlay(); }
      updateOverlay();
    }

    function startRAF() {
      if (rafId != null) return;
      const tick = () => {
        updateOverlay();
        if (props.editor && columnResizingPluginKey.getState(props.editor.state)?.dragging) {
          rafId = requestAnimationFrame(tick);
        } else { stopRAF(); }
      };
      rafId = requestAnimationFrame(tick);
    }

    function stopRAF() {
      if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
    }

    onMounted(() => {
      if (!props.editor) return;
      props.editor.on('selectionUpdate', onSelectionUpdate);
      props.editor.on('transaction', onTransaction);
      startTracking();
      updateOverlay();
    });

    onUnmounted(() => {
      if (props.editor) {
        props.editor.off('selectionUpdate', onSelectionUpdate);
        props.editor.off('transaction', onTransaction);
      }
      stopRAF();
      stopTracking();
    });

    return {
      floatingRef,
      selectionRect, isVisible,
      cornerHandles, startResize, overlayStyle,
    };
  },
};
</script>
