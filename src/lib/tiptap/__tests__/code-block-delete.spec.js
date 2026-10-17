import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import CodeBlockExt from '../exts/code-block/index.js';

// Same extension under test (real Backspace/Delete handlers), only the Vue
// node view is swapped for default DOM rendering: happy-dom cannot reconcile
// Vue node views, which is irrelevant to the doc-level behavior asserted here.
const PlainCodeBlock = CodeBlockExt.extend({
  addNodeView() {
    return undefined;
  },
});

function makeEditor(text) {
  return new Editor({
    extensions: [Document, Paragraph, Text, PlainCodeBlock],
    content: {
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          ...(text ? { content: [{ type: 'text', text }] } : {}),
        },
      ],
    },
  });
}

function firstType(editor) {
  return editor.getJSON().content[0].type;
}

// Dispatch a real keydown through ProseMirror's view handler, like a browser
// would. (The `keyboardShortcut` test command replays captured steps into a
// second dispatch, which corrupts multi-step transactions.)
function pressKey(editor, key) {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
}

describe('code block delete-to-exit', () => {
  it('select-all + Backspace exits in a single press (no empty shell)', () => {
    const editor = makeEditor('hi');
    editor.commands.setTextSelection({ from: 1, to: 3 });
    pressKey(editor, 'Backspace');
    expect(firstType(editor)).toBe('paragraph');
    editor.destroy();
  });

  it('Backspace on the last remaining character exits immediately', () => {
    const editor = makeEditor('h');
    editor.commands.setTextSelection(2);
    pressKey(editor, 'Backspace');
    expect(firstType(editor)).toBe('paragraph');
    editor.destroy();
  });

  it('Backspace at offset 0 of an empty block exits', () => {
    const editor = makeEditor('');
    editor.commands.setTextSelection(1);
    pressKey(editor, 'Backspace');
    expect(firstType(editor)).toBe('paragraph');
    editor.destroy();
  });

  it('Delete on the last remaining character exits immediately', () => {
    const editor = makeEditor('h');
    editor.commands.setTextSelection(1);
    pressKey(editor, 'Delete');
    expect(firstType(editor)).toBe('paragraph');
    editor.destroy();
  });

  it('partial selection delete keeps the code block', () => {
    const editor = makeEditor('hello');
    // select "ell" (positions 2..5)
    editor.commands.setTextSelection({ from: 2, to: 5 });
    pressKey(editor, 'Backspace');
    expect(firstType(editor)).toBe('codeBlock');
    expect(editor.getJSON().content[0].content[0].text).toBe('ho');
    editor.destroy();
  });

  it('mid-text Backspace does not exit the block', () => {
    // Note: happy-dom performs no native editing, so plain char deletion
    // can't be simulated here — this only asserts our handler stays out.
    const editor = makeEditor('hi');
    editor.commands.setTextSelection(3);
    pressKey(editor, 'Backspace');
    expect(firstType(editor)).toBe('codeBlock');
    expect(editor.getJSON().content[0].content[0].text).toBe('hi');
    editor.destroy();
  });
});
