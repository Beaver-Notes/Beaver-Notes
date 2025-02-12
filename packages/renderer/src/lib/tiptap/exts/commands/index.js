import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from 'prosemirror-state';
import tippy from 'tippy.js';
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

          return {
            onStart: (props) => {
              component = new VueRenderer(Commands, {
                props,
                editor: props.editor,
                range: props.range,
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
              component.updateProps(props);

              if (!props.clientRect) {
                return;
              }

              popup[0].setProps({
                getReferenceClientRect: props.clientRect,
              });
            },

            onExit() {
              popup[0].destroy();
              component.destroy();
            },
          };
        },
      }),
    ];
  },
});
