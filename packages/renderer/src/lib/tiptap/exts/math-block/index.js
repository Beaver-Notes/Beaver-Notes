import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import MathBlock from './MathBlock.vue';

const inputRegex = /\$\$\s+$/;

export default Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      content: {
        default: '',
      },
      macros: {
        default: '{\n  \\f: "#1f(#2)"\n}',
      },
      init: {
        default: '',
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'math-block',
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['math-block', mergeAttributes(HTMLAttributes)];
  },
  addNodeView() {
    return VueNodeViewRenderer(MathBlock);
  },
  addInputRules() {
    return [nodeInputRule(inputRegex, this.type)];
  },
});
