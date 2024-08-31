import { Extension } from '@tiptap/core';

const markdownEngine = Extension.create({
  name: 'markdownEngine',

  addInputRules() {
    return [
      // Handle Markdown images first
      {
        find: /!\[([^\]]*)\]\(([^)]+)\)/,
        handler: ({ state, range, match }) => {
          const { tr, selection } = state;
          const { from, to } = range;
          const alt = match[1];
          const src = match[2];

          // Delete the entire matched text
          tr.delete(from, to);

          // Insert an image node
          tr.insert(from, state.schema.nodes.image.create({ src, alt }));

          // Move the selection after the inserted image
          tr.setSelection(selection.constructor.near(tr.doc.resolve(from + 1)));

          if (tr.docChanged && this.editor.view.state === state) {
            this.editor.view.dispatch(tr);
          }

          return true;
        },
      },
      // Handle Markdown links
      {
        find: /\[([^\]]+)\]\(([^)]+)\)/,
        handler: ({ state, range, match }) => {
          const { tr, selection } = state;
          const { from, to } = range;
          const text = match[1];
          const href = match[2];

          // Delete the entire matched text
          tr.delete(from, to);

          // Insert the text with a link mark
          const linkMark = state.schema.marks.link.create({ href });
          tr.insert(from, state.schema.text(text, [linkMark]));

          // Move the selection after the inserted link
          tr.setSelection(
            selection.constructor.near(tr.doc.resolve(from + text.length))
          );

          if (tr.docChanged && this.editor.view.state === state) {
            this.editor.view.dispatch(tr);
          }

          return true;
        },
      },
      // Handle line breaks
      {
        find: /\\ $/,
        handler: ({ state, range }) => {
          const { tr, selection } = state;
          const { from, to } = range;

          tr.delete(from, to).insert(
            from,
            state.schema.nodes.hardBreak.create()
          );

          tr.setSelection(selection.constructor.near(tr.doc.resolve(from + 1)));

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

          tr.delete(from, to).insert(
            from,
            state.schema.nodes.hardBreak.create()
          );

          tr.setSelection(selection.constructor.near(tr.doc.resolve(from + 1)));

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

          tr.delete(from, to).insert(
            from,
            state.schema.nodes.hardBreak.create()
          );

          tr.setSelection(selection.constructor.near(tr.doc.resolve(from + 1)));

          if (tr.docChanged && this.editor.view.state === state) {
            this.editor.view.dispatch(tr);
          }

          return true;
        },
      },
    ];
  },

  addPasteRules() {
    return [
      {
        match: /https?:\/\/[^\s]+/,
        handler: ({ state, range, match }) => {
          const { tr, selection } = state;
          const { from, to } = range;
          const url = match[0];

          // Replace the pasted URL with a link mark
          tr.delete(from, to);
          tr.insert(
            from,
            state.schema.text(url, [
              state.schema.marks.link.create({ href: url }),
            ])
          );

          // Move the selection after the inserted link
          tr.setSelection(
            selection.constructor.near(tr.doc.resolve(from + url.length))
          );

          if (tr.docChanged && this.editor.view.state === state) {
            this.editor.view.dispatch(tr);
          }

          return true;
        },
      },
      // Handle pasted images
      {
        match: /!\[([^\]]*)\]\(([^)]+)\)/,
        handler: ({ state, range, match }) => {
          const { tr, selection } = state;
          const { from, to } = range;
          const alt = match[1];
          const src = match[2];

          // Delete the matched text
          tr.delete(from, to);

          // Insert the image node
          tr.insert(from, state.schema.nodes.image.create({ src, alt }));

          // Move the selection after the inserted image
          tr.setSelection(selection.constructor.near(tr.doc.resolve(from + 1)));

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
