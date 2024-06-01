import { Extension } from '@tiptap/core';

export const LiteralTab = Extension.create({
  name: 'literalTab',

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        return editor
          .chain()
          .focus()
          .command(({ state, dispatch }) => {
            const { $from } = state.selection;
            const startPos = $from.start();

            // Check if a list item is active
            const isListItemActive =
              editor.isActive('bulletList') || editor.isActive('orderedList');

            if (isListItemActive) {
              // Prevent the default behavior of tab key in the editor
              return false;
            }

            // Insert tab character at the current position
            const transaction = state.tr.insertText('\t', startPos);

            const endPos = startPos + 1;
            const selection = state.selection.constructor.near(
              transaction.doc.resolve(endPos)
            );
            transaction.setSelection(selection);
            dispatch(transaction);

            // Prevent the default behavior of tab key in the browser
            return true;
          })
          .run();
      },
    };
  },
});
