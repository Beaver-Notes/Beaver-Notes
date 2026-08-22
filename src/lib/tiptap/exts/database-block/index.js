import { Node, mergeAttributes } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import DatabaseBlockView from './DatabaseBlockView.vue';

export const DatabaseBlock = Node.create({
  name: 'databaseBlock',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      databaseId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-database-id'),
        renderHTML: (attrs) =>
          attrs.databaseId ? { 'data-database-id': attrs.databaseId } : {},
      },
      viewId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-view-id'),
        renderHTML: (attrs) =>
          attrs.viewId ? { 'data-view-id': attrs.viewId } : {},
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-database-id]',
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': this.name }, HTMLAttributes)];
  },
  addNodeView() {
    return VueNodeViewRenderer(DatabaseBlockView);
  },
  addCommands() {
    return {
      setDatabaseBlock:
        (attrs = {}) =>
        ({ tr, dispatch }) => {
          const node = this.type.create(attrs);
          const transaction = tr.replaceSelectionWith(node);
          if (transaction) {
            dispatch(transaction);
            return true;
          }
          return false;
        },
    };
  },
});
