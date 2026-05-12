import { Node, mergeAttributes } from '@tiptap/core';
import { PluginKey } from 'prosemirror-state';
import Suggestion from '@tiptap/suggestion';
import { VueRenderer } from '@tiptap/vue-3';
import { computePosition, autoUpdate, offset, flip, shift } from '@floating-ui/dom';
import SuggestionComponent from './SuggestionComponent.vue';

export default function ({ name, props: customProps = {}, configure = {} }) {
  return Node.create({
    name,

    addOptions() {
      return {
        HTMLAttributes: {},
        renderLabel({ options, node }) {
          return `${options.suggestion.char}${
            node.attrs.label ?? node.attrs.id
          }`;
        },
        suggestion: {
          char: '@',
          allowSpaces: true,
          pluginKey: new PluginKey(name),
          render: () => {
            let component;
            let popup;
            let cleanup;
            let virtualEl;

            return {
              onStart: (props) => {
                component = new VueRenderer(SuggestionComponent, {
                  props: { ...props, ...customProps },
                  editor: props.editor,
                });

                popup = document.createElement('div');
                popup.style.position = 'absolute';
                popup.style.top = '0';
                popup.style.left = '0';
                popup.style.zIndex = '1000';
                document.body.appendChild(popup);
                popup.appendChild(component.element);

                virtualEl = { getBoundingClientRect: props.clientRect };

                const updatePosition = () => {
                  computePosition(virtualEl, popup, {
                    placement: 'bottom-start',
                    middleware: [offset(0), flip(), shift({ padding: 8 })],
                  }).then(({ x, y }) => {
                    Object.assign(popup.style, { left: `${x}px`, top: `${y}px` });
                  });
                };

                cleanup = autoUpdate(virtualEl, popup, updatePosition);
              },
              onUpdate(props) {
                component.updateProps({ ...props, ...customProps });

                if (!props.clientRect) return;

                virtualEl.getBoundingClientRect = props.clientRect;
              },
              onKeyDown(props) {
                if (props.event.key === 'Escape') {
                  popup.style.display = 'none';

                  return true;
                }

                return component.ref?.onKeyDown(props);
              },
              onExit() {
                if (cleanup) cleanup();
                popup?.remove();
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
      };
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
