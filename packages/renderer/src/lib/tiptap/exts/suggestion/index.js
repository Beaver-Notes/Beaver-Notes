import { Node, mergeAttributes } from '@tiptap/core';
import { PluginKey } from 'prosemirror-state';
import Suggestion from '@tiptap/suggestion';
import { VueRenderer } from '@tiptap/vue-3';
import tippy from '@/lib/tippy';
import SuggestionComponent from './SuggestionComponent.vue';

export default function ({ name, props: customProps = {}, configure = {} }) {
  return Node.create({
    name,
    defaultOptions: {
      HTMLAttributes: {},
      renderLabel({ options, node }) {
        return `${options.suggestion.char}${node.attrs.label ?? node.attrs.id}`;
      },
      suggestion: {
        char: '@',
        pluginKey: new PluginKey(name),
        render: () => {
          let component;
          let popup;

          return {
            onStart: (props) => {
              component = new VueRenderer(SuggestionComponent, {
                props: { ...props, ...customProps },
                editor: props.editor,
              });

              popup = tippy('body', {
                getReferenceClientRect: props.clientRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
              });
            },
            onUpdate(props) {
              component.updateProps({ ...props, ...customProps });

              popup[0].setProps({
                getReferenceClientRect: props.clientRect,
              });
            },
            onKeyDown(props) {
              if (props.event.key === 'Escape') {
                popup[0].hide();

                return true;
              }

              return component.ref?.onKeyDown(props);
            },
            onExit() {
              popup[0].destroy();
              component.destroy();
            },
          };
        },
        command: ({ editor, range, props }) => {
          // increase range.to by one when the next node is of type "text"
          // and starts with a space character
          const nodeAfter = editor.view.state.selection.$to.nodeAfter;
          const overrideSpace = nodeAfter?.text?.startsWith(' ');

          if (overrideSpace) {
            range.to += 1;
          }

          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              {
                type: name,
                attrs: props,
              },
              {
                type: 'text',
                text: ' ',
              },
            ])
            .run();
        },
        allow: ({ editor, range }) => {
          return editor.can().insertContentAt(range, { type: name });
        },
      },
    },

    group: 'inline',

    inline: true,

    selectable: false,

    atom: true,

    parseHTML() {
      return [
        {
          tag: `span[data-mention]`,
        },
      ];
    },

    renderHTML({ node, HTMLAttributes }) {
      return [
        'span',
        mergeAttributes(
          { [`data-mention`]: '' },
          this.options.HTMLAttributes,
          HTMLAttributes
        ),
        this.options.renderLabel({
          options: this.options,
          node,
        }),
      ];
    },
    addAttributes() {
      return {
        id: {
          default: null,
          parseHTML: (element) => {
            return {
              id: element.getAttribute('data-id'),
            };
          },
          renderHTML: (attributes) => {
            if (!attributes.id) {
              return {};
            }

            return {
              'data-id': attributes.id,
            };
          },
        },

        label: {
          default: null,
          parseHTML: (element) => {
            return {
              label: element.getAttribute('data-label'),
            };
          },
          renderHTML: (attributes) => {
            if (!attributes.label) {
              return {};
            }

            return {
              'data-label': attributes.label,
            };
          },
        },
      };
    },

    renderText({ node }) {
      return this.options.renderLabel({
        options: this.options,
        node,
      });
    },

    addKeyboardShortcuts() {
      return {
        Backspace: () =>
          this.editor.commands.command(({ tr, state }) => {
            let isMention = false;
            const { selection } = state;
            const { empty, anchor } = selection;

            if (!empty) {
              return false;
            }

            state.doc.nodesBetween(anchor - 1, anchor, (node, pos) => {
              if (node.type.name === this.name) {
                isMention = true;
                tr.insertText(
                  this.options.suggestion.char || '',
                  pos,
                  pos + node.nodeSize
                );

                return false;
              }
            });

            return isMention;
          }),
      };
    },

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          ...this.options.suggestion,
        }),
      ];
    },
    ...configure,
  });
}
