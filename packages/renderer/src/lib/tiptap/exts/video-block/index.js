import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import VideoComponent from './VideoComponent.vue';

const inputRegex = /!\[(.+|:?)]\((\S+)(?:(?:\s+)["'](\S+)["'])?\)/;

export default Node.create({
  name: 'Video',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      src: {
        default: null,
      },
      fileName: {
        default: null,
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-file-name]',
        getAttrs: (el) => ({
          src: el.getAttribute('data-src'),
          fileName: el.getAttribute('data-file-name'),
        }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes)];
  },
  addNodeView() {
    return VueNodeViewRenderer(VideoComponent);
  },
  addCommands() {
    return {
      setVideo:
        (src) =>
        ({ tr, dispatch }) => {
          const node = this.type.create({ src });
          const transaction = tr.replaceSelectionWith(node);
          if (transaction) {
            dispatch(transaction);
            return true;
          }
          return false;
        },
    };
  },
  addInputRules() {
    return [nodeInputRule({ find: inputRegex, type: this.type })];
  },
});
