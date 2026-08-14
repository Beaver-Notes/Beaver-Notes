import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/vue-3';
import createEditor, { yjsExtensions } from '../index.js';

const bulletListDoc = {
  type: 'doc',
  content: [
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'item one' }],
            },
          ],
        },
      ],
    },
  ],
};

// doc offsets: doc(0) bulletList(1) listItem(2) paragraph(3) text(4..11);
// the text "item one" ends at doc position 11 (the textblock end).
const END_OF_ITEM_TEXT = 11;

describe('bullet list Enter', () => {
  it('creates a new list item when Enter is pressed in a bullet list', () => {
    const editor = createEditor({ content: bulletListDoc });
    // Put the cursor at the end of the text inside the list item.
    editor.commands.setTextSelection(END_OF_ITEM_TEXT);
    // Trigger the Enter keymap (replaces insertContentAt('\n')).
    const handled = editor.commands.keyboardShortcut('Enter');
    const json = editor.getJSON();
    expect(handled).toBe(true);
    expect(json.content[0].content).toHaveLength(2);
    expect(json.content[0].content[1].content[0]).toMatchObject({ type: 'paragraph' });
    expect(json.content[0].content[1].content[0].content ?? []).toEqual([]);
    editor.destroy();
  });

  it('splits list items via the yjs extensions variant', () => {
    const editor = new Editor({
      content: bulletListDoc,
      enableCoreExtensions: { paste: false, textDirection: false },
      extensions: yjsExtensions,
    });
    editor.commands.setTextSelection(END_OF_ITEM_TEXT);
    const handled = editor.commands.keyboardShortcut('Enter');
    const json = editor.getJSON();
    expect(handled).toBe(true);
    expect(json.content[0].content).toHaveLength(2);
    editor.destroy();
  });
});
