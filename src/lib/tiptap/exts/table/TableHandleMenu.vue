<template>
  <div
    ref="menuRef"
    class="min-w-[190px]"
    @click.stop
  >
    <!-- Cell Color -->
    <div class="px-2 py-1.5">
      <div class="flex items-center justify-between mb-1">
        <span class="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
          {{ t?.editor?.table?.cellColor || 'Cell color' }}
        </span>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="swatch in colorSwatches"
          :key="swatch"
          class="w-6 h-6 rounded-lg border border-neutral-200 dark:border-neutral-600 cursor-pointer transition-transform hover:scale-105 active:scale-95"
          :style="{ backgroundColor: swatch + '22' }"
          :title="swatch"
          @click="setBg(swatch + '22')"
        />
      </div>
    </div>

    <div class="border-t border-neutral-100 dark:border-neutral-800 mx-2" />

    <!-- Text Alignment -->
    <div class="px-2 py-1.5">
      <span class="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
        {{ t?.editor?.table?.textAlign || 'Align' }}
      </span>
      <div class="flex gap-1 mt-1.5">
        <button
          v-for="opt in alignOptions"
          :key="opt.value"
          class="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 dark:text-neutral-400 transition-colors"
          :class="{ 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white font-medium': currentAlign === opt.value }"
          :title="opt.label"
          @click="setAlign(opt.value)"
        >
          <v-remixicon :name="opt.icon" class="w-4 h-4" />
        </button>
      </div>
    </div>

    <div class="border-t border-neutral-100 dark:border-neutral-800 mx-2" />

    <!-- Toggle header -->
    <button
      class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors"
      :class="isHeaderActive ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white font-medium' : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'"
      @click="toggleHeader"
    >
      <v-remixicon name="riBrush2Fill" class="size-6 shrink-0 text-neutral-500 dark:text-neutral-400" />
      <span>{{ t?.editor?.table?.toggleHeader || 'Toggle header' }}</span>
    </button>

    <div class="border-t border-neutral-100 dark:border-neutral-800 mx-2" />

    <!-- Move -->
    <div>
      <button
        v-for="item in moveItems"
        :key="item.label"
        class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        :class="{ 'opacity-40 pointer-events-none': !item.enabled }"
        @click="item.run"
      >
        <v-remixicon :name="item.icon" class="size-6 shrink-0 text-neutral-500 dark:text-neutral-400" />
        <span>{{ item.label }}</span>
      </button>
    </div>

    <div class="border-t border-neutral-100 dark:border-neutral-800 mx-2" />

    <!-- Add -->
    <div>
      <button
        v-for="item in addItems"
        :key="item.label"
        class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        @click="item.run"
      >
        <v-remixicon :name="item.icon" class="size-6 shrink-0 text-neutral-500 dark:text-neutral-400" />
        <span>{{ item.label }}</span>
      </button>
    </div>

    <div class="border-t border-neutral-100 dark:border-neutral-800 mx-2" />

    <!-- Sort -->
    <div>
      <button
        v-for="item in sortItems"
        :key="item.label"
        class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        @click="item.run"
      >
        <v-remixicon :name="item.icon" class="size-6 shrink-0 text-neutral-500 dark:text-neutral-400" />
        <span>{{ item.label }}</span>
      </button>
    </div>

    <div class="border-t border-neutral-100 dark:border-neutral-800 mx-2" />

    <!-- Duplicate / Delete -->
    <div>
      <button
        class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        @click="duplicate"
      >
        <v-remixicon name="riFileCopyLine" class="size-6 shrink-0 text-neutral-500 dark:text-neutral-400" />
        <span>{{ t?.editor?.table?.duplicate || 'Duplicate' }}</span>
      </button>
      <button
        class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
        @click="deleteRowColumn"
      >
        <v-remixicon :name="orientation === 'row' ? 'riDeleteRow' : 'riDeleteColumn'" class="size-6 shrink-0 text-red-400" />
        <span>{{ orientation === 'row' ? (t?.menu?.deleteRow || 'Delete row') : (t?.menu?.deleteColumn || 'Delete column') }}</span>
      </button>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { getTranslations } from '@/utils/getTranslations';
import { getTable, getRowCells, getColumnCells, selectLastCell, TABLE_COLOR_SWATCHES, TABLE_ALIGN_OPTIONS } from './tiptap-table-utils.js';
import { moveTableRow, moveTableColumn } from '@tiptap/pm/tables';

export default {
  props: {
    editor: { type: Object, default: null },
    state: { type: Object, default: null },
    orientation: { type: String, default: 'row' },
  },
  emits: ['close'],
  setup(props, { emit }) {
    const t = getTranslations();
    const menuRef = ref(null);
    const isHeaderActive = ref(false);
    const currentAlign = ref('left');

    const colorSwatches = TABLE_COLOR_SWATCHES;
    const alignOptions = TABLE_ALIGN_OPTIONS;

    const index = computed(() => props.orientation === 'row' ? props.state?.rowIndex : props.state?.colIndex);
    const tablePos = computed(() => props.state?.blockPos);
    const tableNode = computed(() => props.state?.block);

    const moveItems = computed(() => {
      const items = [];
      if (props.orientation === 'row') {
        items.push({ label: t?.editor?.table?.moveUp || 'Move up', icon: 'riArrowUpLine', run: () => move('up'), enabled: index.value > 0 });
        items.push({ label: t?.editor?.table?.moveDown || 'Move down', icon: 'riArrowDownLine', run: () => move('down'), enabled: true });
      } else {
        items.push({ label: t?.editor?.table?.moveLeft || 'Move left', icon: 'riArrowLeftLine', run: () => move('left'), enabled: index.value > 0 });
        items.push({ label: t?.editor?.table?.moveRight || 'Move right', icon: 'riArrowRightLine', run: () => move('right'), enabled: true });
      }
      return items;
    });

    const addItems = computed(() => {
      if (props.orientation === 'row') {
        return [
          { label: t?.menu?.addRowAbove || 'Add row above', icon: 'riInsertRowTop', run: () => add('above') },
          { label: t?.menu?.addRowBelow || 'Add row below', icon: 'riInsertRowBottom', run: () => add('below') },
        ];
      }
      return [
        { label: t?.menu?.addColumnLeft || 'Add column left', icon: 'riInsertColumnLeft', run: () => add('left') },
        { label: t?.menu?.addColumnRight || 'Add column right', icon: 'riInsertColumnRight', run: () => add('right') },
      ];
    });

    const sortItems = computed(() => [
      { label: t?.editor?.table?.sortAsc || 'Sort ascending', icon: 'riSortAsc', run: () => sort('asc') },
      { label: t?.editor?.table?.sortDesc || 'Sort descending', icon: 'riSortDesc', run: () => sort('desc') },
    ]);

    function setBg(color) {
      if (!props.editor) return;
      props.editor.chain().focus().setCellAttribute('background', color).run();
    }

    function setAlign(align) {
      currentAlign.value = align;
      if (!props.editor) return;
      props.editor.chain().focus().setTextAlign(align).run();
    }

    function add(side) {
      if (!props.editor) return;
      if (props.orientation === 'row') {
        props.editor.chain().focus()[side === 'above' ? 'addRowBefore' : 'addRowAfter']().run();
      } else {
        props.editor.chain().focus()[side === 'left' ? 'addColumnBefore' : 'addColumnAfter']().run();
      }
      close();
    }

    function deleteRowColumn() {
      if (!props.editor) return;
      if (props.orientation === 'row') props.editor.chain().focus().deleteRow().run();
      else props.editor.chain().focus().deleteColumn().run();
      close();
    }

    function applyDuplicate(editor, srcCells, dstCells) {
      if (!srcCells.length || !dstCells.length) return;
      let tr = editor.state.tr;
      const edits = [];
      dstCells.forEach((cell, i) => {
        const src = srcCells[i];
        if (cell.node && src?.node) {
          edits.push({
            pos: cell.pos,
            from: cell.pos + 1,
            to: cell.pos + cell.node.nodeSize - 1,
            content: src.node.content,
            attrs: { ...cell.node.attrs, background: src.node.attrs.background },
          });
        }
      });
      edits.sort((a, b) => b.from - a.from);
      edits.forEach(({ pos, from, to, content, attrs }) => {
        tr = tr.replaceWith(from, to, content);
        tr = tr.setNodeMarkup(pos, undefined, attrs);
      });
      editor.view.dispatch(tr);
    }

    function duplicate() {
      if (!props.editor || !tableNode.value) return;
      const cells = props.orientation === 'row'
        ? getRowCells(props.editor, index.value, tablePos.value)
        : getColumnCells(props.editor, index.value, tablePos.value);
      if (!cells.cells.length) return;
      const curIndex = index.value;
      props.editor.commands.freezeHandles();
      if (props.orientation === 'row') {
        props.editor.chain().addRowAfter().run();
        const newCells = getRowCells(props.editor, curIndex + 1, tablePos.value);
        applyDuplicate(props.editor, cells.cells, newCells.cells);
        selectLastCell(props.editor, tableNode.value, tablePos.value, 'row');
      } else {
        props.editor.chain().addColumnAfter().run();
        const newCells = getColumnCells(props.editor, curIndex + 1, tablePos.value);
        applyDuplicate(props.editor, cells.cells, newCells.cells);
        selectLastCell(props.editor, tableNode.value, tablePos.value, 'column');
      }
      props.editor.commands.unfreezeHandles();
      close();
    }

    function move(direction) {
      if (!props.editor) return;
      const delta = direction === 'up' || direction === 'left' ? -1 : 1;
      const newIndex = index.value + delta;
      if (props.orientation === 'row') {
        moveTableRow({ from: index.value, to: newIndex, select: true, pos: tablePos.value + 1 })(props.editor.state, props.editor.view.dispatch.bind(props.editor.view));
      } else {
        moveTableColumn({ from: index.value, to: newIndex, select: true, pos: tablePos.value + 1 })(props.editor.state, props.editor.view.dispatch.bind(props.editor.view));
      }
      close();
    }

    function sort(direction) {
      if (!props.editor || !tableNode.value) return;
      const cells = props.orientation === 'row'
        ? getRowCells(props.editor, index.value, tablePos.value)
        : getColumnCells(props.editor, index.value, tablePos.value);
      if (cells.cells.length < 2) return;
      const sortedIndices = cells.cells.map((_, i) => i).sort((a, b) => {
        const aText = cells.cells[a]?.node?.textContent?.trim() ?? '';
        const bText = cells.cells[b]?.node?.textContent?.trim() ?? '';
        return direction === 'asc' ? aText.localeCompare(bText) : bText.localeCompare(aText);
      });
      props.editor.commands.freezeHandles();
      for (let i = 0; i < sortedIndices.length; i++) {
        if (i !== sortedIndices[i]) {
          const delta = i > sortedIndices[i] ? -1 : 1;
          const dest = i + delta;
          if (props.orientation === 'row') {
            moveTableRow({ from: i, to: dest, select: true, pos: tablePos.value + 1 })(props.editor.state, props.editor.view.dispatch.bind(props.editor.view));
          } else {
            moveTableColumn({ from: i, to: dest, select: true, pos: tablePos.value + 1 })(props.editor.state, props.editor.view.dispatch.bind(props.editor.view));
          }
        }
      }
      props.editor.commands.unfreezeHandles();
      close();
    }

    function toggleHeader() {
      if (!props.editor) return;
      const editor = props.editor;
      const isRow = props.orientation === 'row';
      const index = isRow ? props.state?.rowIndex : props.state?.colIndex;
      const tablePos = props.state?.blockPos;
      if (index == null || tablePos == null) return;
      const table = getTable(editor, tablePos);
      if (!table) return;
      const cells = isRow
        ? getRowCells(editor, index, tablePos).cells
        : getColumnCells(editor, index, tablePos).cells;
      const allHeader = cells.every((c) => c.node?.type.name === 'tableHeader');
      const targetType = allHeader ? editor.schema.nodes.tableCell : editor.schema.nodes.tableHeader;
      let tr = editor.state.tr;
      cells.forEach((c) => {
        if (c.node) {
          tr = tr.setNodeMarkup(c.pos, targetType, c.node.attrs);
        }
      });
      editor.view.dispatch(tr);
      close();
    }

    function close() {
      emit('close');
    }

    return {
      t, menuRef, isHeaderActive, currentAlign,
      colorSwatches, alignOptions,
      moveItems, addItems, sortItems,
      add, deleteRowColumn, duplicate, move, sort, toggleHeader, close,
      setBg, setAlign,
    };
  },
};
</script>
