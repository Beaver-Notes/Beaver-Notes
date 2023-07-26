import { VueNodeViewRenderer } from '@tiptap/vue-3';
import lowlight from 'lowlight';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import CodeBlockComponent from './CodeBlockComponent.vue';

export default CodeBlockLowlight.extend({
  addNodeView() {
    return VueNodeViewRenderer(CodeBlockComponent);
  },
}).configure({ lowlight });
