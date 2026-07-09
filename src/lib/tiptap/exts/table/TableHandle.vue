<template>
  <Teleport to="body">
    <div
      v-if="state?.show"
      class="fixed inset-0 z-10"
      style="pointer-events: none"
    >
      <div
        v-if="showRowHandle"
        ref="rowFloatingRef"
        :style="rowFloatingStyles"
        class="table-handle-floating"
      >
        <ui-popover
          placement="right-start"
          :model-value="rowMenuOpen"
          @update:model-value="onRowMenuChange"
        >
          <template #trigger>
            <button
              draggable="true"
              class="thandle"
              :class="{ dragging: isRowDragging, open: rowMenuOpen }"
              :title="'Row ' + ((state?.rowIndex ?? 0) + 1)"
              @click.prevent
              @dragstart.stop="onRowDragStart"
              @dragend.stop="onDragEnd"
            >
              <svg viewBox="0 0 24 24" class="thandle-icon" fill="currentColor">
                <circle cx="9" cy="5" r="1.5" />
                <circle cx="15" cy="5" r="1.5" />
                <circle cx="9" cy="12" r="1.5" />
                <circle cx="15" cy="12" r="1.5" />
                <circle cx="9" cy="19" r="1.5" />
                <circle cx="15" cy="19" r="1.5" />
              </svg>
            </button>
          </template>
          <TableHandleMenuContent
            :editor="editor"
            :state="state"
            orientation="row"
            @close="closeRowMenu"
          />
        </ui-popover>
      </div>

      <div
        v-if="showColHandle"
        ref="colFloatingRef"
        :style="colFloatingStyles"
        class="table-handle-floating"
      >
        <ui-popover
          placement="bottom"
          :model-value="colMenuOpen"
          @update:model-value="onColMenuChange"
        >
          <template #trigger>
            <button
              draggable="true"
              class="thandle"
              :class="{ dragging: isColDragging, open: colMenuOpen }"
              :title="'Col ' + ((state?.colIndex ?? 0) + 1)"
              @click.prevent
              @dragstart.stop="onColDragStart"
              @dragend.stop="onDragEnd"
            >
              <svg viewBox="0 0 24 24" class="thandle-icon" fill="currentColor">
                <circle cx="5" cy="9" r="1.5" />
                <circle cx="12" cy="9" r="1.5" />
                <circle cx="19" cy="9" r="1.5" />
                <circle cx="5" cy="15" r="1.5" />
                <circle cx="12" cy="15" r="1.5" />
                <circle cx="19" cy="15" r="1.5" />
              </svg>
            </button>
          </template>
          <TableHandleMenuContent
            :editor="editor"
            :state="state"
            orientation="column"
            @close="closeColMenu"
          />
        </ui-popover>
      </div>
    </div>
  </Teleport>
</template>

<script>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useFloating, offset } from '@floating-ui/vue';
import { colDragStart, rowDragStart, dragEnd } from './table-handle-plugin.js';
import TableHandleMenuContent from './TableHandleMenu.vue';
import UiPopover from '@/components/ui/Popover.vue';

export default {
  components: { TableHandleMenuContent, UiPopover },
  props: { editor: { type: Object, default: null } },
  setup(props) {
    const state = ref(null);
    const rowMenuOpen = ref(false);
    const colMenuOpen = ref(false);
    const isRowDragging = ref(false);
    const isColDragging = ref(false);
    const rowFloatingRef = ref(null);
    const colFloatingRef = ref(null);

    function onState(newState) {
      state.value = { ...newState };
    }

    onMounted(() => {
      if (props.editor) props.editor.on('tableHandleState', onState);
    });
    onUnmounted(() => {
      if (props.editor) props.editor.off('tableHandleState', onState);
    });

    function freezeHandles() {
      props.editor?.commands?.freezeHandles();
    }
    function unfreezeHandles() {
      props.editor?.commands?.unfreezeHandles();
    }

    const showRowHandle = computed(() => {
      if (!state.value?.show) return false;
      if (state.value.draggingState?.draggedCellOrientation === 'col')
        return false;
      return (
        typeof state.value.rowIndex === 'number' && state.value.rowIndex >= 0
      );
    });

    const showColHandle = computed(() => {
      if (!state.value?.show) return false;
      if (state.value.draggingState?.draggedCellOrientation === 'row')
        return false;
      return (
        typeof state.value.colIndex === 'number' && state.value.colIndex >= 0
      );
    });

    // Virtual reference for row handle: spans full table width at the cell's row
    const rowVirtualRef = computed(() => {
      if (!state.value?.referencePosCell || !state.value?.referencePosTable)
        return null;
      const c = state.value.referencePosCell;
      const t = state.value.referencePosTable;
      return {
        getBoundingClientRect: () => new DOMRect(t.x, c.y, t.width, c.height),
      };
    });

    // Virtual reference for column handle: spans full table height at the cell's column
    const colVirtualRef = computed(() => {
      if (!state.value?.referencePosCell || !state.value?.referencePosTable)
        return null;
      const c = state.value.referencePosCell;
      const t = state.value.referencePosTable;
      return {
        getBoundingClientRect: () => new DOMRect(c.x, t.y, c.width, t.height),
      };
    });

    const { floatingStyles: rowFloatingStyles, update: rowUpdate } =
      useFloating(rowVirtualRef, rowFloatingRef, {
        placement: 'left',
        middleware: [offset(1)],
      });

    const { floatingStyles: colFloatingStyles, update: colUpdate } =
      useFloating(colVirtualRef, colFloatingRef, {
        placement: 'top',
        middleware: [offset(1)],
      });

    // Update Floating UI when state changes (new cell hovered, scroll, etc.)
    watch(
      [
        () => state.value?.referencePosCell,
        () => state.value?.referencePosTable,
      ],
      () => {
        rowUpdate();
        colUpdate();
      },
      { deep: true }
    );

    function onRowMenuChange(val) {
      rowMenuOpen.value = val;
      if (val) freezeHandles();
      else if (!colMenuOpen.value) unfreezeHandles();
    }

    function onColMenuChange(val) {
      colMenuOpen.value = val;
      if (val) freezeHandles();
      else if (!rowMenuOpen.value) unfreezeHandles();
    }

    function closeRowMenu() {
      rowMenuOpen.value = false;
      if (!colMenuOpen.value) unfreezeHandles();
    }
    function closeColMenu() {
      colMenuOpen.value = false;
      if (!rowMenuOpen.value) unfreezeHandles();
    }

    function onRowDragStart(e) {
      closeRowMenu();
      isRowDragging.value = true;
      rowDragStart(
        {
          dataTransfer: e.dataTransfer,
          currentTarget: e.currentTarget,
          clientY: e.clientY,
        },
        props.editor,
        props.editor.view
      );
    }

    function onColDragStart(e) {
      closeColMenu();
      isColDragging.value = true;
      colDragStart(
        {
          dataTransfer: e.dataTransfer,
          currentTarget: e.currentTarget,
          clientX: e.clientX,
        },
        props.editor,
        props.editor.view
      );
    }

    function onDragEnd() {
      isRowDragging.value = false;
      isColDragging.value = false;
      dragEnd();
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        if (rowMenuOpen.value) closeRowMenu();
        if (colMenuOpen.value) closeColMenu();
      }
    }

    function onResize() {
      rowUpdate();
      colUpdate();
    }

    onMounted(() => {
      document.addEventListener('keydown', onKeyDown);
      window.addEventListener('resize', onResize);
    });

    onUnmounted(() => {
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    });

    return {
      state,
      rowMenuOpen,
      colMenuOpen,
      isRowDragging,
      isColDragging,
      rowFloatingRef,
      colFloatingRef,
      rowFloatingStyles,
      colFloatingStyles,
      showRowHandle,
      showColHandle,
      onRowMenuChange,
      onColMenuChange,
      closeRowMenu,
      closeColMenu,
      onRowDragStart,
      onColDragStart,
      onDragEnd,
    };
  },
};
</script>

<style>
.thandle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  cursor: pointer;
  pointer-events: auto;
  border: 1px solid theme('colors.neutral.300');
  background: theme('colors.white');
  color: theme('colors.neutral.500');
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
:root.dark .thandle {
  border-color: theme('colors.neutral.600');
  background: theme('colors.neutral.800');
  color: theme('colors.neutral.400');
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}
.thandle:hover,
.thandle.open {
  color: hsl(var(--twc-primary));
  border-color: hsl(var(--twc-primary) / 0.3);
  background: hsl(var(--twc-primary) / 0.08);
}
:root.dark .thandle:hover,
:root.dark .thandle.open {
  color: hsl(var(--twc-primary));
  border-color: hsl(var(--twc-primary) / 0.3);
  background: hsl(var(--twc-primary) / 0.08);
}
.thandle:active {
  transform: scale(0.92);
}
.thandle-icon {
  width: 14px;
  height: 14px;
}
.table-handle-floating {
  z-index: 30;
}
</style>
