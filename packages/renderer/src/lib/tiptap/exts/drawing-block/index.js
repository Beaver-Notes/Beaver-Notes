import { Node, mergeAttributes, VueNodeViewRenderer } from '@tiptap/vue-3';
import Component from './Paper.vue';

export default Node.create({
  name: 'paper',

  group: 'block',

  atom: true,

  addAttributes() {
    return {
      lines: {
        default: [],
      },
      height: {
        default: 400, // Default height
      },
      paperType: {
        default: 'plain',
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="paper"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'paper',
        style: `height: ${HTMLAttributes.height}px;`, // Set initial height via style
      }),
    ];
  },

  addNodeView() {
    return VueNodeViewRenderer(Component);
  },

  addCommands() {
    return {
      insertPaper:
        () =>
        ({ commands }) => {
          return commands.insertContent({
            type: 'paper',
            attrs: { lines: [], height: 800 }, // Ensure default height is set
          });
        },
    };
  },
});
