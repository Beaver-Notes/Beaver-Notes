import { TableHeader } from '@tiptap/extension-table';
import { cellBackgroundAttribute } from './CustomTableCell.js';

export const CustomTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...cellBackgroundAttribute,
    };
  },
});
