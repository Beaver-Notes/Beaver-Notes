import { Table } from '@tiptap/extension-table/table';
import { columnResizing, tableEditing } from '@tiptap/pm/tables';
import { CustomTableView } from './CustomTableView.js';
import { EMPTY_CELL_WIDTH, RESIZE_MIN_WIDTH } from './tiptap-table-utils.js';

export const CustomTable = Table.extend({
  addProseMirrorPlugins() {
    const isResizable = this.options.resizable && this.editor.isEditable;

    const defaultCellMinWidth =
      this.options.cellMinWidth < EMPTY_CELL_WIDTH
        ? EMPTY_CELL_WIDTH
        : this.options.cellMinWidth;

    return [
      ...(isResizable
        ? [
            columnResizing({
              handleWidth: this.options.handleWidth,
              cellMinWidth: RESIZE_MIN_WIDTH,
              defaultCellMinWidth,
              lastColumnResizable: this.options.lastColumnResizable,
            }),
          ]
        : []),
      tableEditing({
        allowTableNodeSelection: this.options.allowTableNodeSelection,
      }),
    ];
  },

  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const cellMinWidth =
        this.options.cellMinWidth < EMPTY_CELL_WIDTH
          ? EMPTY_CELL_WIDTH
          : this.options.cellMinWidth;
      return new CustomTableView(node, cellMinWidth, HTMLAttributes);
    };
  },
});
