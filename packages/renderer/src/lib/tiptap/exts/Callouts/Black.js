import { Node, mergeAttributes, wrappingInputRule } from '@tiptap/core';

export const blackCallout = Node.create({
  name: 'blackCallout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      class: {
        default:
          'p-1 blackCallout border-l-4 border-gray-700 dark:border-gray-500 pl-4 bg-gray-900 dark:bg-gray-400 dark:bg-opacity-10 bg-opacity-10',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div.blackCallout' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },

  addCommands() {
    return {
      setCallout:
        (attrs) =>
        ({ commands }) => {
          return commands.wrapIn(this.name, attrs);
        },
      toggleCallout:
        (attrs) =>
        ({ commands }) => {
          return commands.toggleWrap(this.name, attrs);
        },
      unsetCallout:
        () =>
        ({ commands }) => {
          return commands.lift(this.name);
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-c': () => this.editor.commands.toggleCallout(),
    };
  },

  addInputRules() {
    return [
      wrappingInputRule({
        find: /(?:^|\s)>(\[black])$/,
        type: this.type,
        getContent: (match) => {
          const [, black] = match;
          return black ? [{ type: 'text', text: black }] : undefined;
        },
      }),
    ];
  },
});
