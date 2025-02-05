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
              const { editor } = this;
              if (!editor) return false;

              const clipboardData = event.clipboardData;
              if (!clipboardData) return false;

              // Check all items in clipboard for non-text content
              const hasNonTextContent = Array.from(clipboardData.items).some(
                (item) => {
                  const type = item.type.toLowerCase();
                  return !type.startsWith('text/');
                }
              );

              // If there's any non-text content, let the default handler process it
              if (hasNonTextContent) {
                return false;
              }

              // If we only have text content, process it
              const text = clipboardData.getData('text/plain');
              if (!text) return false;

              try {
                const md = new MarkdownIt();
                const parsedHtml = md.render(text);

                const json = generateJSON(parsedHtml, [
                  StarterKit,
                  Link.configure({ openOnClick: false }),
                ]);

                editor.commands.setContent('', {
                  parseOptions: { preserveWhitespace: false },
                });

                editor.commands.insertContent(json, {
                  parseOptions: { preserveWhitespace: false },
                });

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
