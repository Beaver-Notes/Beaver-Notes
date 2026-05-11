import { Node, mergeAttributes } from '@tiptap/core';

export const ColumnContainer = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column*',
  selectable: true,
  inline: false,

  parseHTML() {
    return [
      {
        tag: 'div[data-type="column-container"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'column-container',
      }),
      0,
    ];
  },
});