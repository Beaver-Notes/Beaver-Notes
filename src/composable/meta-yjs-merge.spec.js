import { describe, expect, it } from 'vitest';
import {
  mergeNoteEntry,
  diffRemovedNoteIds,
} from './meta-yjs-merge.js';

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
