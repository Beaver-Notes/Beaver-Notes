import { Extension } from '@tiptap/core';

export const LiteralTab = Extension.create({
  name: 'literalTab',

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        return this.editor
          .chain()
          .focus()
          .command(({ tr, state }) => {
            const { $from } = state.selection;
            const startPos = $from.start();

            // Check if a list item is active
            const isListItemActive =
              this.editor.isActive('bulletList') ||
              this.editor.isActive('orderedList');

            try {
              if (isListItemActive) {
                event.preventDefault(); // You might need to handle this more appropriately
              } else {
                tr = tr.insertText('\t', startPos);

                const endPos = startPos + 1;
                const selection = state.selection.constructor.near(
                  tr.doc.resolve(endPos)
                );
                tr = tr.setSelection(selection);
              }
            } catch (error) {
              console.error('Error applying transaction:', error);
            }

            return tr; // Return the modified transaction
          })
          .run(); // Run the chain once
      },
    };
  },
});
