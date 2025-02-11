import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import MarkdownIt from 'markdown-it';
import { generateJSON } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';

export const Paste = Extension.create({
  name: 'paste',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('Paste'),
        props: {
          handleDOMEvents: {
            paste: (view, event) => {
              event.preventDefault();
              const { editor } = this;
              if (!editor) return false;

              const clipboardData = event.clipboardData;
              if (!clipboardData) return false;

              // Check all items in clipboard for non-text content
              const hasNonTextContent = Array.from(clipboardData.items).some(
                (item) => !item.type.startsWith('text/')
              );

              if (hasNonTextContent) {
                return false;
              }

              const text = clipboardData.getData('text/plain');
              if (!text) return false;

              try {
                const md = new MarkdownIt();

                // Render MarkdownIt output
                const parsedHtml = md.render(text);

                // If MarkdownIt output is different from the input, it's likely Markdown
                const isMarkdown = parsedHtml !== `<p>${text}</p>\n`;

                if (isMarkdown) {
                  const json = generateJSON(parsedHtml, [
                    StarterKit,
                    Link.configure({ openOnClick: false }),
                  ]);

                  editor.commands.insertContentAt(
                    view.state.selection.from,
                    json,
                    {
                      parseOptions: { preserveWhitespace: 'full' },
                    }
                  );
                } else {
                  // Insert as plain text without Markdown parsing
                  editor.commands.insertContentAt(
                    view.state.selection.from,
                    text,
                    {
                      parseOptions: { preserveWhitespace: 'full' },
                    }
                  );
                }

                return true;
              } catch (error) {
                console.error('Error processing markdown:', error);
                return false;
              }
            },
          },
        },
      }),
    ];
  },
});
