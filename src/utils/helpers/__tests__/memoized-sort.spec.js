import { describe, expect, it, vi, afterEach } from 'vitest';
import { memoizedSort } from '../memoized-sort.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('memoizedSort', () => {
  it('returns sorted data on first call', () => {
    const data = [
      { id: 'a', title: 'Zulu', updatedAt: 101 },
      { id: 'b', title: 'Bravo', updatedAt: 102 },
      { id: 'c', title: 'Golf', updatedAt: 103 },
    ];

    const sorted = memoizedSort({ data, key: 'title', order: 'asc' });
    expect(sorted).toBeInstanceOf(Array);
    expect(sorted.map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });

  it('does not re-run Array.prototype.sort on a cache hit', () => {
    const data = [
      { id: 'a', title: 'Foxtrot', updatedAt: 201 },
      { id: 'b', title: 'Alpha', updatedAt: 202 },
      { id: 'c', title: 'Charlie', updatedAt: 203 },
    ];
    const sortSpy = vi.spyOn(Array.prototype, 'sort');

    memoizedSort({ data, key: 'title', order: 'asc' });
    expect(sortSpy).toHaveBeenCalledTimes(1);

    const second = memoizedSort({ data, key: 'title', order: 'asc' });
    expect(second.map((n) => n.id)).toEqual(['b', 'c', 'a']);
    expect(sortSpy).toHaveBeenCalledTimes(1);
  });

  it('re-sorts when a fresh array reference is provided', () => {
    let data = [
      { id: 'a', title: 'Yankee', updatedAt: 301 },
      { id: 'b', title: 'Mango', updatedAt: 302 },
      { id: 'c', title: 'Sierra', updatedAt: 303 },
    ];
    const sortSpy = vi.spyOn(Array.prototype, 'sort');

    memoizedSort({ data, key: 'title', order: 'asc' });
    expect(sortSpy).toHaveBeenCalledTimes(1);

    // Pinia getters (the only real callers) return a fresh array after any
    // note mutation — the reference change is the invalidation signal.
    data = data.map((n) => (n.id === 'a' ? { ...n, title: 'Ant' } : n));
    const reSorted = memoizedSort({ data, key: 'title', order: 'asc' });
    expect(reSorted.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(sortSpy).toHaveBeenCalledTimes(2);
  });

  it('does not let different data arrays evict each other cache', () => {
    const dataA = [
      { id: 'a', title: 'Tango', updatedAt: 401 },
      { id: 'b', title: 'Lima', updatedAt: 402 },
      { id: 'c', title: 'Oscar', updatedAt: 403 },
    ];
    const dataB = [
      { id: 'x', title: 'Juliet', updatedAt: 501 },
      { id: 'y', title: 'Kilo', updatedAt: 502 },
      { id: 'z', title: 'Mike', updatedAt: 503 },
    ];
    const sortSpy = vi.spyOn(Array.prototype, 'sort');

    memoizedSort({ data: dataA, key: 'title', order: 'asc' });
    memoizedSort({ data: dataB, key: 'title', order: 'asc' });
    expect(sortSpy).toHaveBeenCalledTimes(2);

    const againA = memoizedSort({ data: dataA, key: 'title', order: 'asc' });
    expect(againA.map((n) => n.id)).toEqual(['b', 'c', 'a']);
    expect(sortSpy).toHaveBeenCalledTimes(2);
  });

  it('sorts null/undefined keys last', () => {
    const data = [
      { id: 'a', rank: 3 },
      { id: 'b', rank: null },
      { id: 'c', rank: 1 },
      { id: 'd', rank: undefined },
    ];

    const sorted = memoizedSort({ data, key: 'rank', order: 'asc' });
    expect(sorted.map((n) => n.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('returns non-array data as-is', () => {
    const obj = { foo: 'bar' };
    expect(memoizedSort({ data: obj, key: 'title' })).toBe(obj);
    expect(memoizedSort({ data: null, key: 'title' })).toBeNull();
    expect(memoizedSort({ data: undefined, key: 'title' })).toBeUndefined();
  });
});