import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import CollapsibleSection from './CollapsibleSection.vue';

const inputRegex = /::\s+$/;

export default Node.create({
  name: 'collapsibleSection',
  group: 'block',
  content: 'block*',
  defining: true,
  addAttributes() {
    return {
      title: {
        default: 'Title',
      },
      open: {
        default: false,
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'collapsible-section',
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['collapsible-section', mergeAttributes(HTMLAttributes)];
  },
  addNodeView() {
    return VueNodeViewRenderer(CollapsibleSection);
  },
  addInputRules() {
    return [nodeInputRule({ find: inputRegex, type: this.type })];
  },
});
