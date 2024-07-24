import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import AudioComponent from './AudioComponent.vue';

const inputRegex = /!\[(.+|:?)]\((\S+)(?:(?:\s+)["'](\S+)["'])?\)/;

export default Node.create({
  name: 'Audio',
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
    return VueNodeViewRenderer(AudioComponent);
  },
  addCommands() {
    return {
      setAudio:
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
