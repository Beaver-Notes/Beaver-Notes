import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from 'prosemirror-state';
import { computePosition, autoUpdate, offset, flip, shift } from '@floating-ui/dom';
import { VueRenderer } from '@tiptap/vue-3';
import Commands from './Commands.vue';

export default Extension.create({
  name: 'Commands',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        pluginKey: new PluginKey('commands-menu'),
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: this.options.suggestion.pluginKey,
        char: this.options.suggestion.char,
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          props.action();
        },
        render: () => {
          let component;
          let popup;
          let cleanup;
          let virtualEl;

          return {
            onStart: (props) => {
              component = new VueRenderer(Commands, {
                props: {
                  ...props,
                  editor: props.editor,
                  range: props.range,
                  command: ({ editor, range, props }) => {
                    editor.chain().focus().deleteRange(range).run();
                    props.action();
                  },
                },
                editor: props.editor,
              });

              popup = document.createElement('div');
              popup.dataset.commandMenu = '';
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
              component.updateProps({
                ...props,
                editor: props.editor,
                range: props.range,
                command: ({ editor, range, props }) => {
                  editor.chain().focus().deleteRange(range).run();
                  props.action();
                },
              });

              if (!props.clientRect) return;

              virtualEl.getBoundingClientRect = props.clientRect;
            },

            onKeyDown(props) {
              if (props.event.key === 'Escape') {
                popup.style.display = 'none';
                return true;
              }

              return component.ref?.onKeyDown?.(props);
            },

            onExit() {
              if (cleanup) cleanup();
              popup?.remove();
              component.destroy();
            },
          };
        },
      }),
    ];
  },
});
