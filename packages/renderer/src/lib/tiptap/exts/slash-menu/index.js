import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from 'prosemirror-state';
import tippy from 'tippy.js';
import { VueRenderer } from '@tiptap/vue-3';
import SlashMenu from './slash-menu.vue';

export default Extension.create({
  name: 'slashCommand',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        pluginKey: new PluginKey('slash-menu'),
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
          props.updateQuery('');
        },
        render: () => {
          let component;
          let popup;

          return {
            onStart: (props) => {
              // Create a VueRenderer for the SlashMenu component
              component = new VueRenderer(SlashMenu, {
                props: {
                  query: props.query, // Use the query here
                  editor: props.editor,
                  onKeyDown: this.onKeyDown, // Pass the keyDown handler to the component
                  updateQuery: (newQuery) => {
                    // Update the query when necessary, such as when a menu item is selected
                    props.editor.commands.setTextSelection(props.range); // Ensure editor keeps track of selection
                    props.editor.commands.insertContent(newQuery); // Insert new content or query
                  },
                },
                editor: props.editor,
              });

              const referenceClientRect = props.clientRect;
              const viewportWidth = window.innerWidth;
              const viewportHeight = window.innerHeight;
              const padding = 10; // Optional padding for safety margin

              // Calculate distances from viewport edges
              const distanceFromTop = referenceClientRect.top;
              const distanceFromBottom =
                viewportHeight - referenceClientRect.bottom;
              const distanceFromLeft = referenceClientRect.left;
              const distanceFromRight =
                viewportWidth - referenceClientRect.right;

              let placement = 'bottom-start'; // Default position

              // Logic for dynamic positioning based on proximity to edges
              if (distanceFromTop > distanceFromBottom) {
                placement = 'top-start'; // More space above
              } else if (distanceFromLeft > distanceFromRight) {
                placement = 'left-start'; // More space on the left
              } else {
                placement = 'right-start'; // More space on the right
              }

              // Initialize a tippy.js instance with the VueRenderer element
              popup = tippy('body', {
                getReferenceClientRect: props.clientRect,
                appendTo: () => document.body,
                content: component.element,
                interactive: true,
                showOnCreate: true,
                trigger: 'manual',
                placement, // Dynamically set the placement
                offset: [0, padding], // Optional offset to add some margin
              })[0]; // Access the first instance from the tippy array
            },

            onUpdate: (props) => {
              if (component) {
                // Update the props with the query value for dynamic filtering
                component.updateProps({
                  query: props.query,
                });
              }

              if (popup) {
                popup.setProps({
                  getReferenceClientRect: props.clientRect,
                });
              }
            },

            onExit: () => {
              popup?.destroy();
              component?.destroy();
            },
          };
        },
      }),
    ];
  },
});
