import { VueNodeViewRenderer } from '@tiptap/vue-3';
import CodeBlock from '@tiptap/extension-code-block';
import CodeBlockComponent from './CodeBlockComponent.vue';
import { createCodeHighlightPlugin } from './plugin';

export default CodeBlock.extend({
  addNodeView() {
    return VueNodeViewRenderer(CodeBlockComponent);
  },

  addKeyboardShortcuts() {
    return {
      ...(typeof this.parent === 'function' ? this.parent() : {}),

      Backspace: () => {
        const { empty, $anchor } = this.editor.state.selection;

        if (!empty || $anchor.parent.type.name !== this.name) {
          return false;
        }

        if ($anchor.parentOffset === 0) {
          return this.editor.commands.clearNodes();
        }

        return false;
      },
    };
  },

  addAttributes() {
    return {
      language: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('language') || element.dataset?.language,
        renderHTML: (attributes) => ({ language: attributes.language }),
      },
    };
  },

  addProseMirrorPlugins() {
    return [createCodeHighlightPlugin(this.name)];
  },
});
