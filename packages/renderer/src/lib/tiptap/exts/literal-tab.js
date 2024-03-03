import { Extension } from '@tiptap/core';

export const LiteralTab = Extension.create({
  name: 'literalTab',

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        console.log('test');
        return this.editor
          .chain()
          .focus()
          .command(({ tr, state }) => {
            const { $from } = state.selection;
            const startPos = $from.pos;

            tr.insertText('\t', startPos);

            const endPos = startPos + 1;
            const selection = state.selection.constructor.near(
              tr.doc.resolve(endPos)
            );
            tr.setSelection(selection);

            return true;
          })
          .run();
      },
    };
  },
});
