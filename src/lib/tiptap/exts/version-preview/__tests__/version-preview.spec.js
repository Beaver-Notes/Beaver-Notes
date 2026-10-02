import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { computeVersionChanges } from '../index.js';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    text: { group: 'inline' },
  },
  marks: {},
});

function doc(...paragraphs) {
  return schema.node(
    'doc',
    null,
    paragraphs.map((text) => schema.node('paragraph', null, text ? [schema.text(text)] : []))
  );
}

describe('computeVersionChanges', () => {
  it('reports text added since the snapshot in live-doc coordinates', () => {
    const snapshot = doc('Hello world');
    const current = doc('Hello there world');

    const changes = computeVersionChanges(snapshot, current);
    const inserted = changes
      .filter((c) => c.toB > c.fromB)
      .map((c) => current.textBetween(c.fromB, c.toB, ' '))
      .join('');

    expect(inserted).toContain('there');
  });

  it('reports text removed since the snapshot as a deletion', () => {
    const snapshot = doc('Hello world');
    const current = doc('Hello');

    const changes = computeVersionChanges(snapshot, current);
    const removed = changes
      .filter((c) => c.deleted.length)
      .map((c) => snapshot.textBetween(c.fromA, c.toA, ' '))
      .join('');

    expect(removed).toContain('world');
  });
});
