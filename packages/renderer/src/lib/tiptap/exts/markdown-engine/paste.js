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

              const insertIntelligently = (json) => {
                if (
                  json.type === 'doc' &&
                  json.content?.length === 1 &&
                  json.content[0].type === 'paragraph'
                ) {
                  return editor.commands.insertContent(
                    json.content[0].content || []
                  );
                }
                return editor.commands.insertContent(json);
              };

              if (html) {
                event.preventDefault();
                const container = document.createElement('div');
                container.innerHTML = html;

                container.querySelectorAll('a').forEach((link) => {
                  link.querySelectorAll('span').forEach((span) => {
                    const textNode = document.createTextNode(
                      span.textContent || ''
                    );
                    link.replaceChild(textNode, span);
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
                  insertIntelligently(json);
                } catch (error) {
                  console.error('Error generating JSON from HTML:', error);
                  return false;
                }
                return true;
              }

              // 3. Handle Plain Text / Markdown Paste
              if (text) {
                event.preventDefault();
                try {
                  // FIX: Removed the .replace(/\n/g, '  \n') which was forcing hard breaks
                  const md = new MarkdownIt({ breaks: true });
                  const normalizedText = text.replace(/\r\n?/g, '\n');

                  const parsedHtml = md.render(normalizedText);
                  const json = generateJSON(parsedHtml, [
                    ...extensions,
                    CollapseHeading,
                    heading,
                  ]);

                  insertIntelligently(json);
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
