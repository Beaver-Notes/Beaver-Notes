import { mergeAttributes } from '@tiptap/core';
import { useNoteStore } from '@/store/note';
import router from '@/router';
import Suggestion from './suggestion';

const props = {
  labelKey: 'title',
  showAdd: true,
  onAdd: async (query, command) => {
    const noteStore = useNoteStore();
    const note = await noteStore.add({ title: query.trim() });
    command({ id: note.id, label: note.title, href: `note://${note.id}` });
  },
  onSelect: ({ item, command }) => {
    command({ id: item.id, label: item.title, href: `note://${item.id}` });
  },
};

const configure = {
  parseHTML() {
    return [
      { tag: 'a[data-link-note]' },
      { tag: 'span[data-link-note]' },
      {
        tag: 'a[href^="note://"]',
        getAttrs: (el) => {
          const href = el.getAttribute('href') || '';
          return {
            id: href.slice('note://'.length),
            label: el.textContent || '',
            href,
          };
        },
      },
      {
        // Legacy content saved before this refactor
        tag: 'span[data-mention]',
        getAttrs: (el) => {
          const innerA = el.querySelector('a[href^="note://"]');
          const href = innerA ? innerA.getAttribute('href') : null;
          return {
            id: el.getAttribute('data-id'),
            label: el.getAttribute('data-label') || el.textContent || '',
            href,
          };
        },
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'a',
      mergeAttributes(
        { 'data-link-note': '' },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      this.options.renderLabel({ options: this.options, node }),
    ];
  },
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-id'),
        renderHTML: (attrs) => (attrs.id ? { 'data-id': attrs.id } : {}),
      },
      label: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-label'),
        renderHTML: (attrs) =>
          attrs.label ? { 'data-label': attrs.label } : {},
      },
      href: {
        default: null,
        parseHTML: (el) => el.getAttribute('href'),
        renderHTML: (attrs) => (attrs.href ? { href: attrs.href } : {}),
      },
    };
  },
  addPasteRules() {
    return [
      {
        find: /\[\[([^\]\n]+)\]\]/g,
        handler: ({ range, match, chain }) => {
          const query = match[1].trim();
          const noteStore = useNoteStore();
          const note =
            noteStore.notes.find(
              (n) => n.title.toLowerCase() === query.toLowerCase()
            ) || noteStore.notes.find((n) => n.id === query);
          if (!note) return;
          chain()
            .insertContentAt(range, [
              {
                type: 'linkNote',
                attrs: {
                  id: note.id,
                  label: note.title,
                  href: `note://${note.id}`,
                },
              },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
      },
      {
        find: /note:\/\/[a-zA-Z0-9_-]+/g,
        handler: ({ range, match, chain }) => {
          const href = match[0];
          const id = href.slice('note://'.length);
          const noteStore = useNoteStore();
          const note = noteStore.notes.find((n) => n.id === id);
          if (!note) return;
          chain()
            .insertContentAt(range, [
              {
                type: 'linkNote',
                attrs: { id: note.id, label: note.title, href },
              },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
      },
    ];
  },
  addCommands() {
    return {
      insertLinkNote:
        (noteId) =>
        ({ commands }) => {
          const noteStore = useNoteStore();
          const note = noteStore.notes.find((n) => n.id === noteId);
          if (!note) return false;
          return commands.insertContent({
            type: 'linkNote',
            attrs: {
              id: note.id,
              label: note.title,
              href: `note://${note.id}`,
            },
          });
        },
      removeLinkNote:
        () =>
        ({ tr, state, dispatch }) => {
          let modified = false;
          const positions = [];
          state.doc.nodesBetween(
            state.selection.from,
            state.selection.to,
            (node, pos) => {
              if (node.type.name === 'linkNote') {
                positions.push({ pos, size: node.nodeSize });
              }
            }
          );
          for (const { pos, size } of positions) {
            const node = state.doc.nodeAt(pos);
            if (!node) continue;
            tr.replaceWith(
              pos,
              pos + size,
              state.schema.text(node.attrs.label ?? node.attrs.id ?? '')
            );
            modified = true;
          }
          if (modified && dispatch) dispatch(tr);
          return modified;
        },
    };
  },
};

const LinkNote = Suggestion({ name: 'linkNote', props, configure }).configure({
  HTMLAttributes: { class: 'note-link' },
  renderLabel({ node }) {
    return node.attrs.label ?? node.attrs.id;
  },
  suggestion: {
    char: '@@',
    items: ({ query }) => {
      const noteStore = useNoteStore();
      return noteStore.notes
        .filter(
          (n) =>
            n.title.toLowerCase().startsWith(query.toLowerCase()) &&
            router.currentRoute.value.params.id !== n.id
        )
        .slice(0, 7);
    },
  },
});

export default LinkNote;
