import Heading from '@tiptap/extension-heading';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import CollapseHeading from './CollapseHeading.vue';
import { mergeAttributes } from '@tiptap/core';

export default Heading.extend({
  addOptions() {
    return {
      levels: [1, 2, 3, 4, 5, 6],
      HTMLAttributes: {
        open: true,
        collapsedContent: '',
      },
    };
  },
  parseHTML() {
    return this.options.levels.map((level) => ({
      tag: `h${level}`,
      attrs: { ...this.options.HTMLAttributes, level },
    }));
  },

  renderHTML({ node, HTMLAttributes }) {
    const hasLevel = this.options.levels.includes(node.attrs.level);
    const level = hasLevel ? node.attrs.level : this.options.levels[0];
    Object.assign(HTMLAttributes, node.attrs);
    // record the initial attributes
    Object.assign(this.options.HTMLAttributes, HTMLAttributes);

    return [
      `h${level}`,
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },
  addAttributes() {
    const options = this.parent?.() ?? {};
    return {
      ...options,
      open: {
        default: true,
        rendered: false,
      },
      collapsedContent: {
        default: '',
        rendered: false,
      },
    };
  },
  addNodeView() {
    // reference: https://github.com/ueberdosis/tiptap/issues/3186
    return VueNodeViewRenderer(CollapseHeading, {
      update: ({ oldNode, newNode, updateProps }) => {
        if (newNode.type.name !== this.name) return false;
        // Make sure to redraw node as the vue renderer will not show the updated children
        if (Object.keys(oldNode.attrs).length === 0) {
          // When `oldNode.attrs` is `{}`, we need to solve it in a special way.
          // collapse
          if (this.options.HTMLAttributes.level === newNode.attrs.level) {
            updateProps();
            return true;
          }
          // toggleHeading
          return false;
        }
        if (newNode.attrs.level !== oldNode.attrs.level) {
          const newLevel = newNode.attrs.level;
          newNode.attrs = { ...oldNode.attrs, level: newLevel };
          return false;
        }
        updateProps();
        return true;
      },
    });
  },
});
