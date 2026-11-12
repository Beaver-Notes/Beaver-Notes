import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';

vi.mock('@/store/app', () => ({ useAppStore: () => ({ setting: { collapsibleHeading: false } }) }));
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import { streamInsertHtml } from '../paste.js';

// Task: large HTML pastes stream by top-level blocks AND stay one undo step.
// These tests verify both halves: the batching contract of streamInsertHtml,
// and the Yjs UndoManager grouping contract that stopCapturing relies on
// (stopCapturing before the first transaction + captureTimeout grouping means
// one undo() reverts the whole paste).

describe('streamInsertHtml (large HTML paste)', () => {
  let insertCalls;
  let stopCapturing;
  let editor;

  beforeEach(() => {
    insertCalls = [];
    stopCapturing = vi.fn();
    editor = {
      commands: {
        insertContent: vi.fn((content) => {
          insertCalls.push(content);
        }),
      },
      extensionStorage: {
        yUndo: { undoManager: { stopCapturing } },
      },
    };
  });

  it('batches blocks at 150 and yields between batches', async () => {
    const blocks = [];
    for (let i = 0; i < 400; i++) {
      blocks.push({ type: 'paragraph', content: [{ type: 'text', text: 'b' + i }] });
    }
    await streamInsertHtml(editor, { type: 'doc', content: blocks });
    expect(insertCalls.length).toBe(3);
    expect(insertCalls[0].length).toBe(150);
    expect(insertCalls[1].length).toBe(150);
    expect(insertCalls[2].length).toBe(100);
    expect(stopCapturing).toHaveBeenCalledTimes(1);
  });

  it('small documents insert in a single call', async () => {
    const blocks = [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }];
    await streamInsertHtml(editor, { type: 'doc', content: blocks });
    expect(insertCalls.length).toBe(1);
    expect(insertCalls[0].length).toBe(1);
  });

  it('calls stopCapturing before the first insert', async () => {
    const blocks = Array.from({ length: 200 }, (_, i) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: 'b' + i }],
    }));
    const order = [];
    stopCapturing.mockImplementation(() => order.push('stop'));
    editor.commands.insertContent.mockImplementation(() => order.push('insert'));
    await streamInsertHtml(editor, { type: 'doc', content: blocks });
    expect(order[0]).toBe('stop');
  });
});

describe('streamInsertHtml survives user typing between batches', () => {
  it('lands later batches after earlier ones, not at the drifted cursor', async () => {
    const { Editor } = await import('@tiptap/core');
    const Doc = (await import('@tiptap/extension-document')).default;
    const Paragraph = (await import('@tiptap/extension-paragraph')).default;
    const Text = (await import('@tiptap/extension-text')).default;
    const Collaboration = (await import('@tiptap/extension-collaboration')).default;

    const ydoc = new Y.Doc();
    const editor = new Editor({
      extensions: [Doc, Paragraph, Text, Collaboration.configure({ document: ydoc })],
      content: '<p>start</p>',
    });

    const blocks = Array.from({ length: 400 }, (_, i) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: 'b' + i }],
    }));

    // The user types at the top of the document while the paste streams.
    const injectUserEdit = () => {
      try {
        editor.commands.insertContentAt(0, {
          type: 'paragraph',
          content: [{ type: 'text', text: 'USER-EDIT' }],
        });
      } catch { /* position races in the split paragraph are tolerated */ }
    };
    const timer = setTimeout(injectUserEdit, 5);

    await streamInsertHtml(editor, { type: 'doc', content: blocks });
    clearTimeout(timer);

    const json = editor.getJSON();
    const texts = (json.content || []).map((n) =>
      (n.content || []).map((c) => c.text || '').join(''),
    );
    const userEditIdx = texts.findIndex((t) => t === 'USER-EDIT');
    const b0Idx = texts.findIndex((t) => t === 'b0');
    const b399Idx = texts.findIndex((t) => t === 'b399');

    expect(userEditIdx).toBeGreaterThanOrEqual(0);
    expect(b0Idx).toBeGreaterThanOrEqual(0);
    expect(b399Idx).toBeGreaterThanOrEqual(0);
    // The user edit must sit BEFORE the pasted stream (it was typed at the
    // top); the pasted blocks keep their own order after it.
    expect(userEditIdx).toBeLessThan(b0Idx);
    expect(b399Idx).toBeGreaterThan(b0Idx);
    // Every paste block survived.
    for (let i = 0; i < 400; i++) {
      expect(texts.find((t) => t === 'b' + i)).toBeDefined();
    }
    editor.destroy();
  });
});

describe('UndoManager groups a streamed paste into one undo step', () => {
  it('one undo() reverts every transaction of the paste', () => {
    const ydoc = new Y.Doc();
    const undoManager = new Y.UndoManager(ydoc, {
      trackedOrigins: new Set([ySyncPluginKey]),
      captureTimeout: 500,
    });

    // Simulate the paste stream: stopCapturing, then rapid transactions under
    // the tracked origin (exactly what insertContent does per batch).
    undoManager.stopCapturing();
    ydoc.transact(() => {
      ydoc.getXmlFragment('content').insert(0, [new Y.XmlElement('paragraph')]);
    }, ySyncPluginKey);
    for (let i = 0; i < 20; i++) {
      ydoc.transact(() => {
        ydoc.getText('title').insert(0, 'x');
      }, ySyncPluginKey);
    }

    expect(undoManager.undoStack.length).toBe(1);
    undoManager.undo();
    expect(ydoc.getXmlFragment('content').length).toBe(0);
    expect(ydoc.getText('title').toString()).toBe('');
  });

  it('a prior edit stays separate from the paste step', () => {
    const ydoc = new Y.Doc();
    const undoManager = new Y.UndoManager(ydoc, {
      trackedOrigins: new Set([ySyncPluginKey]),
    });

    // User types a word...
    ydoc.transact(() => {
      ydoc.getText('title').insert(0, 'hi');
    }, ySyncPluginKey);
    undoManager.stopCapturing();
    // ...then the streamed paste lands.
    ydoc.transact(() => {
      ydoc.getXmlFragment('content').insert(0, [new Y.XmlElement('paragraph')]);
    }, ySyncPluginKey);

    expect(undoManager.undoStack.length).toBe(2);
    undoManager.undo(); // undoes the paste only
    expect(ydoc.getXmlFragment('content').length).toBe(0);
    expect(ydoc.getText('title').toString()).toBe('hi');
    undoManager.undo(); // undoes the prior typing
    expect(ydoc.getText('title').toString()).toBe('');
  });
});
