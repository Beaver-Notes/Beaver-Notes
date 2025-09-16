import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import MarkdownIt from 'markdown-it';
import { generateJSON } from '@tiptap/core';
import { extensions, CollapseHeading, heading } from '@/lib/tiptap';

export const Paste = Extension.create({
  name: 'paste',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('Paste'),
        props: {
          handleDOMEvents: {
            paste: (view, event) => {
              const { editor } = this;
              if (!editor) return false;

              const clipboardData = event.clipboardData;
              if (!clipboardData) return false;

              const html = clipboardData.getData('text/html');
              const text = clipboardData.getData('text/plain');

              const { state } = view;
              const { $from } = state.selection;
              const isInCodeBlock = $from.parent.type.name === 'codeBlock';

              if (isInCodeBlock && text) {
                event.preventDefault();
                editor.commands.insertContent(text);
                return true;
              }

              if (html) {
                event.preventDefault();
                const json = generateJSON(html, [
                  ...extensions,
                  CollapseHeading,
                  heading,
                ]);
                editor.commands.insertContent(json);
                return true;
              }

              if (text) {
                event.preventDefault();
                try {
                  const md = new MarkdownIt();
                  const normalizedText = text
                    .replace(/\r\n?/g, '\n')
                    .replace(/\n/g, '  \n');

                  const parsedHtml = md.render(normalizedText);
                  const json = generateJSON(parsedHtml, [
                    ...extensions,
                    CollapseHeading,
                    heading,
                  ]);

                  editor.commands.insertContent(json, {
                    parseOptions: { preserveWhitespace: false },
                  });
                } catch (error) {
                  console.error('Error processing markdown:', error);
                  return false;
                }
                return true;
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});
