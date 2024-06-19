import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import MermaidDiagram from './MermaidBlock.vue';

const inputRegex = /^::mermaid\s+$/;

export default Node.create({
  name: 'mermaidDiagram',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      content: {
        default: '',
      },
      init: {
        default: '',
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'mermaid-diagram',
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['mermaid-diagram', mergeAttributes(HTMLAttributes)];
  },
  addNodeView() {
    return VueNodeViewRenderer(MermaidDiagram);
  },
  addInputRules() {
    return [nodeInputRule({ find: inputRegex, type: this.type })];
  },
});
