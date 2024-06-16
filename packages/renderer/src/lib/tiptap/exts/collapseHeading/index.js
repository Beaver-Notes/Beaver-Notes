import Heading from '@tiptap/extension-heading';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import CollapseHeading from './CollapseHeading.vue';

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
    return this.options.levels.map((v) => ({
      tag: `h${v}`,
      attrs: {
        level: v,
      },
    }));
  },
  renderHTML(opt) {
    const dom = this.parent?.(opt);
    return dom;
  },
  addAttributes() {
    const options = this.parent?.() ?? {};
    return {
      ...options,
      open: {
        default: true,
      },
      collapsedContent: {
        default: '',
      },
    };
  },
  addNodeView() {
    // reference: https://github.com/ueberdosis/tiptap/issues/3186
    return VueNodeViewRenderer(CollapseHeading, {
      update: ({ oldNode, newNode, updateProps }) => {
        if (newNode.type.name !== this.name) return false;
        // Make sure to redraw node as the vue renderer will not show the updated children
        if (newNode.attrs.level !== oldNode.attrs.level) {
          const attrs = { ...oldNode.attrs };
          attrs.level = newNode.attrs.level;
          newNode.attrs = attrs;
          return false;
        }
        updateProps();
        return true;
      },
    });
  },
});
