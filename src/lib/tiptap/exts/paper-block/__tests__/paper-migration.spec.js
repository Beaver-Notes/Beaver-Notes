import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Paper from '../index.js';
import { PaperStrokesMigration } from '../migrate.js';

const V2_LINES = [
  {
    id: 's1',
    tool: 'pen',
    color: '#1a1a1a',
    size: 4,
    opacity: 1,
    points: [
      [10, 10, 0.5],
      [40, 40, 0.5],
    ],
  },
  {
    id: 's2',
    tool: 'highlighter',
    color: '#fbbf24',
    size: 16,
    opacity: 0.35,
    points: [
      [0, 0, 0.5],
      [30, 0, 0.5],
    ],
  },
];

function makeEditor(content) {
  return new Editor({
    extensions: [Document, Paragraph, Text, Paper, PaperStrokesMigration],
    content,
  });
}

function paperNode(editor) {
  let found = null;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'paper' && !found) found = node;
  });
  return found;
}

function touch(editor) {
  // Any doc-changing transaction triggers appendTransaction migrations.
  editor.commands.insertContentAt(0, { type: 'paragraph' });
}

describe('PaperStrokesMigration', () => {
  it('declares legacy attrs so yjs-backed docs keep their strokes', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [
        { type: 'paper', attrs: { linesV2: V2_LINES, height: 400 } },
      ],
    });
    const node = paperNode(editor);
    // Before any transaction the legacy payload must still be readable.
    expect(Array.isArray(node.attrs.linesV2) && node.attrs.linesV2.length).toBe(2);
    editor.destroy();
  });

  it('folds legacy linesV2 into strokes on the first doc change', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [
        { type: 'paper', attrs: { linesV2: V2_LINES, height: 400, paperType: 'dotted' } },
      ],
    });
    touch(editor);

    const node = paperNode(editor);
    expect(node.attrs.strokes).toHaveLength(2);
    expect(node.attrs.strokes[0].tool).toBe('pen');
    expect(node.attrs.strokes[1].tool).toBe('marker'); // highlighter -> marker
    expect(node.attrs.linesV2).toBeNull();
    expect(node.attrs.height).toBe(400);
    editor.destroy();
  });

  it('reads stringified legacy payloads and the older lines attr', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [
        { type: 'paper', attrs: { lines: JSON.stringify(V2_LINES) } },
      ],
    });
    touch(editor);
    const node = paperNode(editor);
    expect(node.attrs.strokes).toHaveLength(2);
    expect(node.attrs.lines).toBeNull();
    editor.destroy();
  });

  it('keeps existing strokes and clears stale legacy keys', () => {
    const strokes = [
      { id: 'a', tool: 'pen', color: '#000000', size: 4, opacity: 1, points: [[0, 0, 0.5], [5, 5, 0.5]] },
    ];
    const editor = makeEditor({
      type: 'doc',
      content: [
        { type: 'paper', attrs: { strokes, linesV2: V2_LINES } },
      ],
    });
    touch(editor);
    const node = paperNode(editor);
    expect(node.attrs.strokes).toHaveLength(1);
    expect(node.attrs.linesV2).toBeNull();
    editor.destroy();
  });

  it('leaves papers without legacy attrs untouched', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [{ type: 'paper', attrs: { height: 210 } }],
    });
    touch(editor);
    const node = paperNode(editor);
    expect(node.attrs.strokes).toEqual([]);
    editor.destroy();
  });

  it('does not emit legacy data attributes in html', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [{ type: 'paper', attrs: { linesV2: V2_LINES } }],
    });
    touch(editor);
    const html = editor.getHTML();
    expect(html).toContain('data-lines-v3');
    expect(html).not.toContain('data-lines-v2');
    expect(html).not.toContain('data-lines=');
    editor.destroy();
  });

  it('scans once per load — post-load legacy nodes stay untouched', () => {
    const editor = makeEditor({ type: 'doc', content: [{ type: 'paragraph' }] });
    touch(editor); // first docChanged transaction closes the gate
    editor.commands.insertContentAt(0, { type: 'paper', attrs: { linesV2: V2_LINES } });
    const node = paperNode(editor);
    expect(node.attrs.strokes).toEqual([]);
    editor.destroy();
  });
});
