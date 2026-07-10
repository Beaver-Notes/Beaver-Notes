import { Extension } from '@tiptap/core';
import { TableRow } from '@tiptap/extension-table';
import { CustomTable } from './CustomTable.js';
import { CustomTableCell } from './CustomTableCell.js';
import { CustomTableHeader } from './CustomTableHeader.js';

export const TableKit = Extension.create({
  name: 'tableKit',

  addOptions() {
    return {
      table: true,
      tableCell: true,
      tableHeader: true,
      tableRow: true,
    };
  },

  addExtensions() {
    const extensions = [];
    if (this.options.table !== false) extensions.push(CustomTable.configure({ ...this.options.table, HTMLAttributes: this.options.HTMLAttributes }));
    if (this.options.tableCell !== false) extensions.push(CustomTableCell.configure(this.options.tableCell));
    if (this.options.tableHeader !== false) extensions.push(CustomTableHeader.configure(this.options.tableHeader));
    if (this.options.tableRow !== false) extensions.push(TableRow.configure(this.options.tableRow));
    return extensions;
  },
});
