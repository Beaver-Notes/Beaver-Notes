import { describe, expect, it } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { transactionAffectsHeadings } from './headings-detect.js';

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

function run(fn) {
  const state = EditorState.create({ schema, doc: makeDoc() });
  const tr = fn(state.tr);
  return tr;
}

describe('transactionAffectsHeadings', () => {
  it('returns true when heading text is edited', () => {
    const tr = run((t) => t.insertText('!', 9)); // inside 'abc'
    expect(transactionAffectsHeadings(tr)).toBe(true);
  });

  it('returns false for edits that do not touch a heading', () => {
    const tr = run((t) => t.insertText('!', 2)); // inside 'hello'
    expect(transactionAffectsHeadings(tr)).toBe(false);
  });

  it('returns true when a heading is created', () => {
    const tr = run((t) =>
      t.replaceWith(
        7,
        7,
        schema.node('heading', { level: 1 }, [schema.text('new')])
      )
    );
    expect(transactionAffectsHeadings(tr)).toBe(true);
  });

  it('returns true when a heading is deleted', () => {
    const tr = run((t) => t.delete(7, 12)); // the whole heading node
    expect(transactionAffectsHeadings(tr)).toBe(true);
  });

  it('returns false for selection-only transactions', () => {
    const tr = run((t) => {
      t.setSelection(TextSelection.create(t.doc, 2, 3));
      return t;
    });
    expect(transactionAffectsHeadings(tr)).toBe(false);
  });
});
