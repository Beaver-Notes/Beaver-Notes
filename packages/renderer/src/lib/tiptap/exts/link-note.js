import { mergeAttributes } from '@tiptap/core';
import { useNoteStore } from '@/store/note';
import router from '@/router';
import Suggestion from './suggestion';

const props = {
  labelKey: 'title',
  onSelect: ({ item, command, editor, range }) => {
    command({ id: item.id, label: item.title });

    const { from, to } = range;
    editor
      .chain()
      .focus()
      .setTextSelection({ from, to: to - 1 })
      .setLink({ href: `note://${item.id}` })
      .setTextSelection(to)
      .run();
  },
};
const configure = {
  parseHTML() {
    return [
      {
        tag: `span[data-link-note]`,
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(
        { [`data-link-note`]: '' },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      this.options.renderLabel({
        options: this.options,
        node,
      }),
    ];
  },
};

const LinkNote = Suggestion({ name: 'linkNote', props, configure }).configure({
  renderLabel({ node }) {
    return node.attrs.label ?? node.attrs.id;
  },
  suggestion: {
    char: '@@',
    items: (query) => {
      const noteStore = useNoteStore();

      return noteStore.notes
        .filter(
          (item) =>
            item.title.toLocaleLowerCase().startsWith(query.toLowerCase()) &&
            router.currentRoute.value.params.id !== item.id
        )
        .slice(0, 7);
    },
  },
});

export default LinkNote;
