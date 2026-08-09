import { describe, expect, it } from 'vitest';
import {
  mergeNoteEntry,
  diffRemovedNoteIds,
  shouldReadKv,
} from './meta-yjs-merge.js';

describe('mergeNoteEntry', () => {
  it('merges meta into an existing record', () => {
    const existing = { id: '1', title: 'old', content: { type: 'doc' }, updatedAt: 1 };
    const meta = { title: 'new', updatedAt: 2 };
    const { note: merged } = mergeNoteEntry(existing, meta, undefined);
    expect(merged).toMatchObject({ id: '1', title: 'new', updatedAt: 2 });
  });

  it('keeps an existing cardPreview without rebuilding it', () => {
    const existing = { id: '1', title: 'x', cardPreview: { blocks: [{ type: 'p' }] } };
    const { note: merged } = mergeNoteEntry(existing, {}, undefined);
    expect(merged.cardPreview).toEqual({ blocks: [{ type: 'p' }] });
  });

  it('uses EMPTY_CARD_PREVIEW for locked notes', () => {
    const existing = { id: '1', title: 'x', isLocked: true };
    const { note: merged } = mergeNoteEntry(existing, {}, undefined);
    expect(merged.cardPreview).toEqual({ version: 1, blocks: [], hasMore: false, mediaCount: 0, visibleMediaCount: 0 });
  });

  it('reattaches KV content when the note has none in memory', () => {
    const existing = { id: '1', title: 'x' };
    const { note: merged } = mergeNoteEntry(existing, {}, { type: 'doc', content: [] });
    expect(merged.content).toEqual({ type: 'doc', content: [] });
  });

  it('does not overwrite in-memory content with KV content', () => {
    const existing = { id: '1', title: 'x', content: { type: 'doc', content: [{ type: 'p' }] } };
    const { note: merged } = mergeNoteEntry(existing, {}, { type: 'doc', content: [] });
    expect(merged.content).toEqual({ type: 'doc', content: [{ type: 'p' }] });
  });

  it('flags notes that need a snapshot load for their preview', () => {
    const existing = { id: '1', title: 'x' };
    const { note: merged, needsSnapshot } = mergeNoteEntry(existing, {}, undefined);
    expect(needsSnapshot).toBe(true);
    expect(merged.cardPreview).toBeTruthy();
  });

  it('does not flag notes with content as needing a snapshot', () => {
    const existing = { id: '1', title: 'x', content: { type: 'doc', content: [] } };
    const { needsSnapshot } = mergeNoteEntry(existing, {}, undefined);
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

describe('shouldReadKv', () => {
  it('always reads KV before seeding completes', () => {
    expect(shouldReadKv({ kvSeeded: false, changedMetaById: {}, storeData: {} })).toBe(true);
  });

  it('skips KV reads for non-note changes after seeding', () => {
    expect(
      shouldReadKv({ kvSeeded: true, changedMetaById: {}, storeData: {} })
    ).toBe(false);
  });

  it('reads KV when a changed note is locked and has no content in the store', () => {
    expect(
      shouldReadKv({
        kvSeeded: true,
        changedMetaById: { a: { isLocked: true } },
        storeData: { a: { title: 'x' } },
      })
    ).toBe(true);
  });

  it('skips KV when a changed locked note already has content in the store', () => {
    expect(
      shouldReadKv({
        kvSeeded: true,
        changedMetaById: { a: { isLocked: true } },
        storeData: { a: { title: 'x', content: { type: 'doc' } } },
      })
    ).toBe(false);
  });

  it('skips KV for ordinary changed notes after seeding', () => {
    expect(
      shouldReadKv({
        kvSeeded: true,
        changedMetaById: { a: { title: 'new' } },
        storeData: {},
      })
    ).toBe(false);
  });
});
