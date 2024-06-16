import { Node, mergeAttributes, wrappingInputRule } from '@tiptap/core';

export const purpleCallout = Node.create({
  name: 'purpleCallout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      class: {
        default:
          'p-1 purpleCallout border-l-4 border-purple-300 pl-4 bg-purple-500 bg-opacity-10',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div.purpleCallout' }];
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
        find: /(?:^|\s)::purple\s?$/,
        type: this.type,
        getContent: (match) => {
          const [, purple] = match;
          return purple ? [{ type: 'text', text: purple }] : undefined;
        },
      }),
    ];
  },
});
