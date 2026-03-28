import { Node, mergeAttributes, wrappingInputRule } from '@tiptap/core';

/**
 * Creates a colour-specific callout Tiptap extension.
 *
 * @param {object} options
 * @param {string} options.color      - e.g. 'blue'
 * @param {string} options.cssClass   - full default Tailwind class string for the block
 */
export function createCallout({ color, cssClass }) {
  const name = `${color}Callout`;
  const commandName = `set${color.charAt(0).toUpperCase() + color.slice(1)}Callout`;
  const inputPattern = new RegExp(`(?:^|\\s)::${color}\\s?$`);

  return Node.create({
    name,
    group: 'block',
    content: 'block+',
    defining: true,

    addAttributes() {
      return {
        class: { default: cssClass },
      };
    },

    parseHTML() {
      return [{ tag: `div.${name}` }];
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
        [commandName]:
          () =>
          ({ commands }) =>
            commands.wrapIn(this.name),
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
          find: inputPattern,
          type: this.type,
          getContent: (match) => {
            const [, text] = match;
            return text ? [{ type: 'text', text }] : undefined;
          },
        }),
      ];
    },
  });
}
