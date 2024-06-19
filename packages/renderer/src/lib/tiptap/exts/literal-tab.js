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
            const { selection, tr } = state;
            const { $from } = selection;
            const isListItemActive =
              editor.isActive('bulletList') || editor.isActive('orderedList');

            if (isListItemActive) {
              // Prevent the default behavior of the tab key in the editor for list items
              return false;
            }

            // Insert a tab character at the current cursor position
            const transaction = tr.insertText('\t', $from.pos);

            // Move the cursor to the position after the inserted tab character
            const selectionToEnd = selection.constructor.near(
              transaction.doc.resolve($from.pos + 1)
            );
            transaction.setSelection(selectionToEnd);
            dispatch(transaction);

            // Prevent the default behavior of the tab key in the browser
            return true;
          })
          .run();
      },
    };
  },
});
