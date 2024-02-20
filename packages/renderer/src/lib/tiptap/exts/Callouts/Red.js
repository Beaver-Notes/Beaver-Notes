import { Node, mergeAttributes, wrappingInputRule } from '@tiptap/core';

export const redCallout = Node.create({
  name: 'redCallout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      class: {
        default:
          'p-1 redCallout border-l-4 border-red-300 pl-4 bg-red-500 bg-opacity-10',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div.redCallout' }];
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
        find: /(?:^|\s)>(\[red])$/,
        type: this.type,
        getContent: (match) => {
          const [, red] = match;
          return red ? [{ type: 'text', text: red }] : undefined;
        },
      }),
    ];
  },
});
