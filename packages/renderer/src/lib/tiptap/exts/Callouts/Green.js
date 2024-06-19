import { Node, mergeAttributes, wrappingInputRule } from '@tiptap/core';

export const greenCallout = Node.create({
  name: 'greenCallout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      class: {
        default:
          'p-1 greenCallout border-l-4 border-green-700 dark:border-green-500 pl-4 bg-green-900 dark:bg-green-400 dark:bg-opacity-10 bg-opacity-10',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div.greenCallout' }];
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
        find: /(?:^|\s)::green\s?$/,
        type: this.type,
        getContent: (match) => {
          const [, green] = match;
          return green ? [{ type: 'text', text: green }] : undefined;
        },
      }),
    ];
  },
});
