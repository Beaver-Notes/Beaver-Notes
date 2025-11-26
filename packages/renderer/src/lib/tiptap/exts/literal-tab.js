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
              return false;
            }

            const transaction = tr.insertText('\t', $from.pos);

            const selectionToEnd = selection.constructor.near(
              transaction.doc.resolve($from.pos + 1)
            );
            transaction.setSelection(selectionToEnd);
            dispatch(transaction);

            return true;
          })
          .run();
      },
    };
  },
});
