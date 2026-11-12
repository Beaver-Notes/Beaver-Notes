import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import {
  computeVersionChanges,
  findReviewChange,
  revertReviewChange,
} from '../index.js';

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
    paragraphs.map((text) =>
      schema.node('paragraph', null, text ? [schema.text(text)] : [])
    )
  );
}

// Minimal editor stand-in: a real EditorState + a view.dispatch that applies
// the transaction. No TipTap needed to exercise the pure diff/revert helpers.
function makeEditor(d) {
  let state = EditorState.create({ schema, doc: d });
  return {
    get state() {
      return state;
    },
    view: {
      dispatch: (tr) => {
        state = state.apply(tr);
      },
    },
  };
}

function allText(d) {
  return d.textBetween(0, d.content.size, ' ');
}

describe('computeVersionChanges (review baseline)', () => {
  it('reports an added chunk with live-doc positions', () => {
    const snapshot = doc('Hello world');
    const current = doc('Hello there world');

    const changes = computeVersionChanges(snapshot, current);
    const added = changes.filter((c) => c.toB > c.fromB);

    expect(added).toHaveLength(1);
    expect(current.textBetween(added[0].fromB, added[0].toB)).toBe('there ');
  });

  it('reports a removed chunk in snapshot coordinates', () => {
    const snapshot = doc('Hello world');
    const current = doc('Hello');

    const changes = computeVersionChanges(snapshot, current);
    const removed = changes.filter((c) => c.deleted.length);

    expect(removed).toHaveLength(1);
    expect(snapshot.textBetween(removed[0].fromA, removed[0].toA)).toBe(
      ' world'
    );
  });

  it('returns no changes for identical docs', () => {
    const snapshot = doc('Hello world');
    expect(computeVersionChanges(snapshot, doc('Hello world'))).toEqual([]);
    expect(findReviewChange(snapshot, doc('Hello world'), { fromA: 0, toA: 0 })).toBeNull();
  });
});

describe('revertReviewChange', () => {
  it('reverts an added chunk by deleting exactly that text, keeping the rest', () => {
    const snapshot = doc('Alpha', 'Hello world');
    const editor = makeEditor(doc('Alpha', 'Hello there world'));

    const target = computeVersionChanges(snapshot, editor.state.doc).find(
      (c) => c.toB > c.fromB
    );
    expect(revertReviewChange(editor, snapshot, target)).toBe(true);

    expect(allText(editor.state.doc)).toBe('Alpha Hello world');
  });

  it('reverts a removed chunk by restoring exactly that text', () => {
    const snapshot = doc('Hello world');
    const editor = makeEditor(doc('Hello'));

    const target = computeVersionChanges(snapshot, editor.state.doc).find((c) =>
      c.deleted.length
    );
    expect(revertReviewChange(editor, snapshot, target)).toBe(true);

    expect(allText(editor.state.doc)).toBe('Hello world');
  });

  it('reverts a replacement back to the snapshot text', () => {
    const snapshot = doc('The quick fox');
    const editor = makeEditor(doc('The slow fox'));

    // Revert every detected chunk; positions shift after each revert, so the
    // helper must recompute (this mirrors the widget loop).
    let guard = 0;
    while (guard++ < 10) {
      const target = computeVersionChanges(snapshot, editor.state.doc)[0];
      if (!target) break;
      expect(revertReviewChange(editor, snapshot, target)).toBe(true);
    }

    expect(allText(editor.state.doc)).toBe('The quick fox');
  });

  it('refuses to apply a change that no longer matches (stale positions)', () => {
    const snapshot = doc('Hello world');
    const editor = makeEditor(doc('Hello'));
    const staleTarget = { fromA: 999, toA: 999, fromB: 0, toB: 0, deleted: [{}] };

    expect(revertReviewChange(editor, snapshot, staleTarget)).toBe(false);
    expect(allText(editor.state.doc)).toBe('Hello');
  });
});
