import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { runCommand } from '../exts/commands/index.js';

function makeEditor() {
  const editor = new Editor({
    extensions: [Document, Paragraph, Text],
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] },
  });
  return editor;
}

describe('slash command stale range', () => {
  it('does not throw when the doc shrank under the open menu', () => {
    const editor = makeEditor();
    // Menu opened on a bigger doc (e.g. before a Yjs remote update / undo);
    // range.to is now far past the end of the document.
    expect(() =>
      runCommand({
        editor,
        range: { from: 1, to: 6833 },
        props: { action: (ch) => ch.insertContent('X') },
      })
    ).not.toThrow();
    editor.destroy();
  });

  it('still deletes the query range when it is valid', () => {
    const editor = makeEditor();
    runCommand({
      editor,
      range: { from: 1, to: 3 },
      props: { action: (ch) => ch.insertContent('X') },
    });
    expect(editor.getText()).toBe('X');
    editor.destroy();
  });
});
