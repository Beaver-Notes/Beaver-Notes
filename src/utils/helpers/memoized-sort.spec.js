import { describe, expect, it } from 'vitest';
import { memoizedSort } from './memoized-sort.js';

const notes = [
  { id: 'a', title: 'Zebra', updatedAt: 1 },
  { id: 'b', title: 'Apple', updatedAt: 2 },
  { id: 'c', title: 'Mango', updatedAt: 3 },
];

describe('memoizedSort', () => {
  it('returns a sorted array', () => {
    const sorted = memoizedSort({ data: notes, key: 'title', order: 'asc' });
    expect(sorted.map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });

  it('skips re-sorting when the order is unchanged but data changed', () => {
    // 'c' changes updatedAt but keeps its title: the order is identical.
    // We should still return current objects (no stale data).
    memoizedSort({ data: notes, key: 'title', order: 'asc' });
    const changed = [...notes];
    changed[2] = { ...changed[2], updatedAt: 99 };
    const second = memoizedSort({ data: changed, key: 'title', order: 'asc' });
    expect(second.map((n) => n.id)).toEqual(['b', 'c', 'a']);
    expect(second[1].updatedAt).toBe(99); // current object, not stale
  });

  it('recomputes when a sort-relevant field changes order', () => {
    memoizedSort({ data: notes, key: 'title', order: 'asc' });
    const changed = [...notes];
    changed[0] = { ...changed[0], title: 'Ant' };
    const second = memoizedSort({ data: changed, key: 'title', order: 'asc' });
    expect(second.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('recomputes when the key or order changes', () => {
    memoizedSort({ data: notes, key: 'title', order: 'asc' });
    const second = memoizedSort({ data: notes, key: 'title', order: 'desc' });
    expect(second.map((n) => n.id)).toEqual(['a', 'c', 'b']);
  });

  it('does not collide different string values', () => {
    const data = [
      { id: 'a', title: 'ab' },
      { id: 'b', title: 'aa' },
    ];
    const sorted = memoizedSort({ data, key: 'title', order: 'asc' });
    expect(sorted.map((n) => n.id)).toEqual(['b', 'a']);
  });

  it('sorts numbers descending like sortArray', () => {
    const sorted = memoizedSort({ data: notes, key: 'updatedAt', order: 'desc' });
    expect(sorted.map((n) => n.id)).toEqual(['c', 'b', 'a']);
  });
});
