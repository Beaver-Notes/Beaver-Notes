import { VueNodeViewRenderer } from '@tiptap/vue-3';
import { all, createLowlight } from 'lowlight';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import CodeBlockComponent from './CodeBlockComponent.vue';

const lowlight = createLowlight(all);

export default CodeBlockLowlight.extend({
  addNodeView() {
    return VueNodeViewRenderer(CodeBlockComponent);
  },

  addKeyboardShortcuts() {
    return {
      // Include parent keyboard shortcuts (Mod-Alt-c, Tab/Shift-Tab, Enter, ArrowDown, etc.)
      ...(typeof this.parent === 'function' ? this.parent() : {}),

      // Override Backspace to reliably delete/lift the code block when cursor is at the start
      Backspace: () => {
        const { empty, $anchor } = this.editor.state.selection;

        if (!empty || $anchor.parent.type.name !== this.name) {
          return false;
        }

        // Clear the code block (turn into paragraph) when cursor is at position 0
        if ($anchor.parentOffset === 0) {
          return this.editor.commands.clearNodes();
        }

        return false;
      },
    };
  },
}).configure({ lowlight });
