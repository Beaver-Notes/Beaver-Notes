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

                // Create a temporary container
                const container = document.createElement('div');
                container.innerHTML = html;

                // Flatten spans inside links
                container.querySelectorAll('a').forEach((link) => {
                  link.querySelectorAll('span').forEach((span) => {
                    // Merge span text into the link
                    const textNode = document.createTextNode(
                      span.textContent || ''
                    );
                    link.replaceChild(textNode, span);
                    // Optional: store metadata as data attributes on the <a> itself
                    for (const attr of span.attributes) {
                      if (attr.name.startsWith('data-')) {
                        link.setAttribute(
                          attr.name,
                          attr.value.replace(/&nbsp;/g, ' ')
                        );
                      }
                    }
                  });
                });

                // Replace &nbsp; in top-level text nodes
                container.innerHTML = container.innerHTML.replace(
                  /&nbsp;/g,
                  ' '
                );

                const sanitizedHtml = container.innerHTML;

                try {
                  const json = generateJSON(sanitizedHtml, [
                    ...extensions,
                    CollapseHeading,
                    heading,
                  ]);
                  editor.commands.insertContent(json);
                } catch (error) {
                  console.error(
                    'Error generating JSON from sanitized HTML:',
                    error
                  );
                  return false;
                }
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
