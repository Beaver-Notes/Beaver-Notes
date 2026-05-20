import { Table } from '@tiptap/extension-table/table';
import { CustomTableView } from './CustomTableView.js';

export const CustomTable = Table.extend({
  name: 'table',

  addOptions() {
    return {
      ...this.parent?.(),
      HTMLAttributes: {},
      resizable: true,
      renderWrapper: false,
      handleWidth: 5,
      cellMinWidth: 25,
      View: CustomTableView,
      lastColumnResizable: true,
      allowTableNodeSelection: false,
    };
  },
});
