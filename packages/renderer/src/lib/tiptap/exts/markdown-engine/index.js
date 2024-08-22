import { Extension } from '@tiptap/core';

const markdownEngine = Extension.create({
  name: 'markdownEngine',

  addInputRules() {
    return [
      {
        find: /\\ $/,
        handler: ({ state, range }) => {
          const { tr, selection } = state;
          const { from, to } = range;

          // Replace matched text with a hard break
          tr.delete(from, to).insert(
            from,
            state.schema.nodes.hardBreak.create()
          );

          // Set selection after the hard break
          tr.setSelection(selection.constructor.near(tr.doc.resolve(from + 1)));

          // Check and apply transaction
          if (tr.docChanged && this.editor.view.state === state) {
            this.editor.view.dispatch(tr);
          }

          return true;
        },
      },
      {
        find: /<br>$/,
        handler: ({ state, range }) => {
          const { tr, selection } = state;
          const { from, to } = range;

          // Replace matched text with a hard break
          tr.delete(from, to).insert(
            from,
            state.schema.nodes.hardBreak.create()
          );

          // Set selection after the hard break
          tr.setSelection(selection.constructor.near(tr.doc.resolve(from + 1)));

          // Check and apply transaction
          if (tr.docChanged && this.editor.view.state === state) {
            this.editor.view.dispatch(tr);
          }

          return true;
        },
      },
      {
        find: /<br\s*\/>$/,
        handler: ({ state, range }) => {
          const { tr, selection } = state;
          const { from, to } = range;

          // Replace matched text with a hard break
          tr.delete(from, to).insert(
            from,
            state.schema.nodes.hardBreak.create()
          );

          // Set selection after the hard break
          tr.setSelection(selection.constructor.near(tr.doc.resolve(from + 1)));

          // Check and apply transaction
          if (tr.docChanged && this.editor.view.state === state) {
            this.editor.view.dispatch(tr);
          }

          return true;
        },
      },
    ];
  },
});

export default markdownEngine;
