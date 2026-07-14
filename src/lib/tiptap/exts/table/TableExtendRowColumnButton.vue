<template>
  <Teleport v-if="state?.widgetContainer" :to="state.widgetContainer">
    <div v-if="showRowBtn" ref="rowFloatingRef" :style="rowFloatingStyles">
      <button
        class="text-extend-btn"
        :title="t?.editor?.table?.addRowBelow || 'Add row'"
        @click="addRow"
        @mousedown.prevent="startDrag('row', $event)"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" class="extend-icon"><path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2z"/></svg>
      </button>
    </div>
    <div v-if="showColBtn" ref="colFloatingRef" :style="colFloatingStyles">
      <button
        class="text-extend-btn"
        :title="t?.editor?.table?.addColumnRight || 'Add column'"
        @click="addCol"
        @mousedown.prevent="startDrag('col', $event)"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" class="extend-icon"><path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2z"/></svg>
      </button>
    </div>
  </Teleport>
</template>

<script>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { getTranslations } from '@/utils/getTranslations';
import { useFloating, offset, size } from '@floating-ui/vue';
import { EMPTY_CELL_WIDTH, EMPTY_CELL_HEIGHT, selectLastCell, runPreservingCursor, countEmptyRowsFromEnd, countEmptyColumnsFromEnd, marginRound } from './tiptap-table-utils.js';
import { TableMap } from '@tiptap/pm/tables';

export default {
  props: { editor: { type: Object, default: null } },
  setup(props) {
    const t = getTranslations();
    const state = ref(null);
    const rowFloatingRef = ref(null);
    const colFloatingRef = ref(null);

    function onState(newState) { state.value = newState; }

    onMounted(() => { if (props.editor) props.editor.on('tableHandleState', onState); });
    onUnmounted(() => { if (props.editor) props.editor.off('tableHandleState', onState); });

    const rowVirtualRef = computed(() => {
      if (!state.value?.referencePosTable) return null;
      const t = state.value.referencePosTable;
      return { getBoundingClientRect: () => new DOMRect(t.x, t.bottom, t.width, 0) };
    });

    const colVirtualRef = computed(() => {
      if (!state.value?.referencePosTable) return null;
      const t = state.value.referencePosTable;
      return { getBoundingClientRect: () => new DOMRect(t.right, t.y, 0, t.height) };
    });

    const { floatingStyles: rowFloatingStyles } = useFloating(
      rowVirtualRef,
      rowFloatingRef,
      {
        placement: 'bottom',
        middleware: [
          offset(4),
          size({ apply({ rects, elements }) {
            if (elements.floating) elements.floating.style.width = `${rects.reference.width}px`;
          }}),
        ],
      }
    );

    const { floatingStyles: colFloatingStyles } = useFloating(
      colVirtualRef,
      colFloatingRef,
      {
        placement: 'right',
        middleware: [
          offset(4),
          size({ apply({ rects, elements }) {
            if (elements.floating) elements.floating.style.height = `${rects.reference.height}px`;
          }}),
        ],
      }
    );

    const showRowBtn = computed(() => state.value?.showAddOrRemoveRowsButton && state.value?.referencePosTable);
    const showColBtn = computed(() => state.value?.showAddOrRemoveColumnsButton && state.value?.referencePosTable);

    let dragState = null;

    function addRow() {
      if (!props.editor) return;
      runPreservingCursor(props.editor, () => {
        selectLastCell(props.editor, state.value.block, state.value.blockPos, 'row');
        props.editor.chain().focus().addRowAfter().run();
      });
    }

    function addCol() {
      if (!props.editor) return;
      runPreservingCursor(props.editor, () => {
        selectLastCell(props.editor, state.value.block, state.value.blockPos, 'column');
        props.editor.chain().focus().addColumnAfter().run();
      });
    }

    function startDrag(orientation, ev) {
      if (!state.value) return;
      const dims = TableMap.get(state.value.block);
      dragState = {
        orientation,
        startPos: orientation === 'row' ? ev.clientY : ev.clientX,
        originalHeight: dims.height,
        originalWidth: dims.width,
        moved: false,
      };
      if (props.editor) props.editor.commands.freezeHandles();

      const onMove = (e) => {
        if (!dragState || !props.editor || !state.value) return;
        dragState.moved = true;
        const isRow = dragState.orientation === 'row';
        const currentPos = isRow ? e.clientY : e.clientX;
        const diff = currentPos - dragState.startPos;
        const cellSize = isRow ? EMPTY_CELL_HEIGHT : EMPTY_CELL_WIDTH;
        const currentDims = TableMap.get(state.value.block);
        const currentCount = isRow ? currentDims.height : currentDims.width;
        const originalCount = isRow ? dragState.originalHeight : dragState.originalWidth;
        const newCount = Math.max(1, originalCount + marginRound(diff / cellSize, 0.3));
        const delta = newCount - currentCount;
        if (delta === 0) return;

        runPreservingCursor(props.editor, () => {
          selectLastCell(props.editor, state.value.block, state.value.blockPos, isRow ? 'row' : 'column');
          if (delta > 0) {
            for (let i = 0; i < delta; i++) {
              if (isRow) props.editor.chain().focus().addRowAfter().run();
              else props.editor.chain().focus().addColumnAfter().run();
            }
          } else {
            const absDelta = Math.abs(delta);
            const emptyCount = isRow
              ? countEmptyRowsFromEnd(props.editor, state.value.blockPos)
              : countEmptyColumnsFromEnd(props.editor, state.value.blockPos);
            const safeToRemove = Math.min(absDelta, emptyCount, currentCount - 1);
            for (let i = 0; i < safeToRemove; i++) {
              if (isRow) props.editor.chain().focus().deleteRow().run();
              else props.editor.chain().focus().deleteColumn().run();
            }
          }
        });
      };

      const onUp = () => {
        if (props.editor) props.editor.commands.unfreezeHandles();
        dragState = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    return {
      t, state,
      rowFloatingRef, colFloatingRef, rowFloatingStyles, colFloatingStyles,
      showRowBtn, showColBtn,
      addRow, addCol, startDrag,
    };
  },
};
</script>

<style scoped>
.text-extend-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-width: 20px;
  min-height: 20px;
  border-radius: 4px;
  border: 1px solid theme('colors.neutral.200');
  background: theme('colors.white');
  color: theme('colors.neutral.400');
  cursor: pointer;
  transition: color 0.1s ease;
  pointer-events: auto;
  font-size: 0;
}
:root.dark .text-extend-btn {
  border-color: theme('colors.neutral.700');
  background: theme('colors.neutral.800');
  color: theme('colors.neutral.500');
}
.text-extend-btn:hover {
  color: hsl(var(--twc-primary));
  border-color: hsl(var(--twc-primary) / 0.3);
  background: hsl(var(--twc-primary) / 0.08);
}
.extend-icon { width: 14px; height: 14px; }
</style>
