import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  mergeNoteEntry,
  diffRemovedNoteIds,
} from './meta-merge.js';

describe('mergeNoteEntry', () => {
  it('merges meta into an existing record', () => {
    const existing = { id: '1', title: 'old', content: { type: 'doc' }, updatedAt: 1 };
    const meta = { title: 'new', updatedAt: 2 };
    const { note: merged } = mergeNoteEntry(existing, meta);
    expect(merged).toMatchObject({ id: '1', title: 'new', updatedAt: 2 });
  });

  it('keeps an existing cardPreview without rebuilding it', () => {
    const existing = { id: '1', title: 'x', cardPreview: { blocks: [{ type: 'p' }] } };
    const { note: merged } = mergeNoteEntry(existing, {});
    expect(merged.cardPreview).toEqual({ blocks: [{ type: 'p' }] });
  });

  it('uses EMPTY_CARD_PREVIEW for locked notes', () => {
    const existing = { id: '1', title: 'x', isLocked: true };
    const { note: merged } = mergeNoteEntry(existing, {});
    expect(merged.cardPreview).toEqual({ version: 1, blocks: [], hasMore: false, mediaCount: 0, visibleMediaCount: 0 });
  });

  it('flags notes with no content source as needing a snapshot load', () => {
    // Content lives in the per-note Yjs doc, never in the workspace meta.
    const existing = { id: '1', title: 'x' };
    const { note: merged, needsSnapshot } = mergeNoteEntry(existing, {});
    expect(needsSnapshot).toBe(true);
    expect(merged.cardPreview).toBeTruthy();
  });

  it('does not flag notes with content as needing a snapshot', () => {
    const existing = { id: '1', title: 'x', content: { type: 'doc', content: [] } };
    const { needsSnapshot } = mergeNoteEntry(existing, {});
    expect(needsSnapshot).toBe(false);
  });

  it('uses a persisted cardPreview from the workspace doc (no snapshot load)', () => {
    const cardPreview = { blocks: [{ kind: 'text', text: 'Hello' }], hasMore: false };
    const { note: merged, needsSnapshot } = mergeNoteEntry(
      {},
      { id: '1', title: 'x', cardPreview }
    );
    expect(needsSnapshot).toBe(false);
    expect(merged.cardPreview).toBe(cardPreview);
  });
});

describe('diffRemovedNoteIds', () => {
  it('reports store ids missing from the doc', () => {
    const removed = diffRemovedNoteIds(
      ['a', 'b', 'c'],
      new Set(['a', 'c'])
    );
    expect(removed).toEqual(['b']);
  });

  it('returns empty when nothing is removed', () => {
    expect(diffRemovedNoteIds(['a', 'b'], new Set(['a', 'b', 'c']))).toEqual([]);
  });
});

describe('backfill isolation regression', () => {
  it('two sequential snapshots must not accumulate (reused Y.Doc produces superset)', async () => {
    const tmpBuggy = new Y.Doc();
    const a = new Y.Doc();
    a.getXmlFragment('content').insert(0, ['A']);
    const b = new Y.Doc();
    b.getXmlFragment('content').insert(0, ['B']);
    const updA = Y.encodeStateAsUpdate(a);
    const updB = Y.encodeStateAsUpdate(b);
    Y.applyUpdate(tmpBuggy, updA);
    Y.applyUpdate(tmpBuggy, updB);
    // buggy tmp now contains A+B: assert naive reuse produces superset
    expect(tmpBuggy.getXmlFragment('content').length).toBeGreaterThan(1);

    // fixed: fresh doc per snapshot
    const tmpFixedA = new Y.Doc();
    Y.applyUpdate(tmpFixedA, updA);
    const tmpFixedB = new Y.Doc();
    Y.applyUpdate(tmpFixedB, updB);
    expect(tmpFixedA.getXmlFragment('content').length).toBe(1);
    expect(tmpFixedB.getXmlFragment('content').length).toBe(1);
  });
});
