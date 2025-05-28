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

              const hasNonTextContent = Array.from(clipboardData.items).some(
                (item) => !item.type.startsWith('text/')
              );
              if (hasNonTextContent) {
                return false;
              }
              if (clipboardData.getData('text/html')) {
                return false;
              }
              const text = clipboardData.getData('text/plain');
              if (!text) return false;

              const { state } = view;
              const { $from } = state.selection;

              // Detect if we're inside a codeBlock
              const isInCodeBlock = $from.parent.type.name === 'codeBlock';

              event.preventDefault();

              if (isInCodeBlock) {
                // Inside code block: just insert plain text
                editor.commands.insertContent(text);
              } else {
                // Outside code block: parse and insert as rich content
                try {
                  const md = new MarkdownIt();
                  const normalizedText = text
                    .replace(/\r\n?/g, '\n') // Normalize Windows line endings
                    .replace(/\n/g, '  \n'); // Make all newlines Markdown hard breaks

                  const parsedHtml = md.render(normalizedText);
                  const json = generateJSON(parsedHtml, [
                    StarterKit,
                    Link.configure({ openOnClick: false }),
                  ]);

                  const paragraphs = json.content.map((c) => c.content);
                  const newJson = [];
                  for (let i = 0, len = paragraphs.length; i < len; i++) {
                    const paragraph = paragraphs[i];
                    if (i !== 0) {
                      newJson.push(
                        { type: 'hardBreak' },
                        { type: 'hardBreak' }
                      );
                    }
                    newJson.push(...paragraph);
                  }

                  editor.commands.insertContent(newJson, {
                    parseOptions: { preserveWhitespace: false },
                  });
                } catch (error) {
                  console.error('Error processing markdown:', error);
                  return false;
                }
              }

              return true;
            },
          },
        },
      }),
    ];
  },
});
