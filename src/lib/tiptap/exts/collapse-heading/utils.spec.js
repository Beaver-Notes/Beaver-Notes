import { describe, expect, it } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { collectEmptyHeadingPositions } from './utils.js';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { level: { default: 1 } },
    },
    text: { group: 'inline' },
  },
});

function makeDoc() {
  return schema.node('doc', null, [
    schema.node('paragraph', null, [schema.text('hello')]),
    schema.node('heading', { level: 1 }, [schema.text('abc')]),
    schema.node('paragraph', null, [schema.text('world')]),
  ]);
}

function apply(state, tr) {
  return { doc: tr.doc, transactions: [tr] };
}

describe('collectEmptyHeadingPositions', () => {
  it('returns the position of a heading emptied by deletion', () => {
    const state = EditorState.create({ schema, doc: makeDoc() });
    const tr = state.tr.delete(8, 11); // delete 'abc' inside heading
    const { doc } = apply(state, tr);

    const positions = collectEmptyHeadingPositions(doc, [tr]);
    expect(positions).toEqual([7]);
  });

  it('returns nothing when the change does not touch a heading', () => {
    const state = EditorState.create({ schema, doc: makeDoc() });
    const tr = state.tr.insertText('!', 2); // edit inside paragraph 'hello'
    const { doc } = apply(state, tr);

    expect(collectEmptyHeadingPositions(doc, [tr])).toEqual([]);
  });

  it('does not touch an empty heading far from the change', () => {
    // heading #2 is already empty; the change happens in the last paragraph
    const doc = schema.node('doc', null, [
      schema.node('heading', { level: 1 }, [schema.text('abc')]),
      schema.node('heading', { level: 1 }, []),
      schema.node('paragraph', null, [schema.text('tail')]),
    ]);
    const state = EditorState.create({ schema, doc });
    const tr = state.tr.insertText('!', 13); // inside 'tail'
    const { doc: newDoc } = apply(state, tr);

    expect(collectEmptyHeadingPositions(newDoc, [tr])).toEqual([]);
  });

  it('handles chained transactions by mapping ranges into the final doc', () => {
    // First transaction empties the heading (deletes 'abc')
    const state = EditorState.create({ schema, doc: makeDoc() });
    const first = state.tr.delete(8, 11);

    // Second transaction is built on top of the first's result doc
    const intermediate = first.doc;
    const second = EditorState.create({
      schema,
      doc: intermediate,
    }).tr.insertText('!', 2);
    const finalDoc = second.doc;

    // Simulate the two transactions arriving as one batch
    const positions = collectEmptyHeadingPositions(finalDoc, [first, second]);
    // The insert before the heading shifts it to position 8 in the final doc
    expect(positions).toEqual([8]);
  });
});
