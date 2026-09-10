import { VueNodeViewRenderer } from '@tiptap/vue-3';
import { TextSelection } from '@tiptap/pm/state';
import CodeBlock from '@tiptap/extension-code-block';
import CodeBlockComponent from './CodeBlockComponent.vue';
import { createCodeHighlightPlugin } from './plugin';

/**
 * Empty the block and exit it to a paragraph in a single transaction (one
 * undo step). `clearNodes` can't be chained after a deletion: it walks the
 * stale pre-chain doc and silently no-ops.
 */
function emptyAndExit(editor, blockName) {
  const { $anchor } = editor.state.selection;
  if ($anchor.parent.type.name !== blockName) {
    return false;
  }
  const paragraph = editor.schema.nodes.paragraph;
  if (!paragraph) {
    return editor.commands.clearNodes();
  }
  const contentStart = $anchor.start();
  const contentEnd = $anchor.end();
  return editor.commands.command(({ tr }) => {
    if (contentEnd > contentStart) {
      tr.delete(contentStart, contentEnd);
    }
    tr.setNodeMarkup(contentStart - 1, paragraph);
    tr.setSelection(TextSelection.create(tr.doc, contentStart, contentStart));
    return true;
  });
}

/**
 * Shared Backspace/Delete handling for code blocks. Goal: never strand an
 * empty code block (toolbar pill with no body). The press that empties the
 * block also exits it:
 * - empty block -> clearNodes (exit to paragraph)
 * - selection covers the whole block text -> delete + exit
 * - cursor on the last remaining character -> delete + exit
 * Anything else falls through to the default behavior.
 */
function handleDeleteKey(editor, blockName, direction) {
  const { empty, $anchor, $from, $to } = editor.state.selection;
  if ($anchor.parent.type.name !== blockName) {
    return false;
  }

  const parent = $anchor.parent;
  const textLength = parent.textContent.length;

  if (textLength === 0) {
    return editor.commands.clearNodes();
  }

  if (!empty) {
    const coversAll =
      $from.parent === parent &&
      $to.parent === parent &&
      $from.parentOffset === 0 &&
      $to.parentOffset === textLength;
    if (!coversAll) {
      return false;
    }
    return emptyAndExit(editor, blockName);
  }

  const onLastChar =
    textLength === 1 &&
    (direction === 'backward'
      ? $anchor.parentOffset === 1
      : $anchor.parentOffset === 0);
  if (onLastChar) {
    return emptyAndExit(editor, blockName);
  }
  if ($anchor.parentOffset === 0) {
    return editor.commands.clearNodes();
  }
  return false;
}

export default CodeBlock.extend({
  addNodeView() {
    return VueNodeViewRenderer(CodeBlockComponent);
  },

  addKeyboardShortcuts() {
    return {
      ...(typeof this.parent === 'function' ? this.parent() : {}),

      Backspace: () => handleDeleteKey(this.editor, this.name, 'backward'),
      Delete: () => handleDeleteKey(this.editor, this.name, 'forward'),
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
