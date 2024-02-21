import { Node, mergeAttributes, wrappingInputRule } from '@tiptap/core';

export const blueCallout = Node.create({
  name: 'blueCallout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      class: {
        default:
          'p-1 blueCallout border-l-4 border-blue-300 pl-4 bg-blue-500 bg-opacity-10',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div.blueCallout' }];
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
        find: /(?:^|\s)>(\[blue])$/,
        type: this.type,
        getContent: (match) => {
          const [, blue] = match;
          return blue ? [{ type: 'text', text: blue }] : undefined;
        },
      }),
    ];
  },
});
