import { Node, mergeAttributes } from '@tiptap/core';

export const Column = Node.create({
  name: 'column',
  group: 'block',
  content: 'block+',
  defining: true,
  selectable: true,

  addAttributes() {
    return {
      flexGrow: {
        default: 1,
        parseHTML: (element) =>
          parseFloat(element.style.flexGrow) || 1,
        renderHTML: (attributes) => {
          if (!attributes.flexGrow) {
            return {};
          }
          return {
            style: `flex-grow: ${attributes.flexGrow};`,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="column"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'column',
      }),
      0,
    ];
  },
});