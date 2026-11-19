import { describe, expect, it } from 'vitest';
import { matchNoteIdsByQuery } from './search-matches.js';

const notes = [
  { id: '1', title: 'Shopping list', searchText: 'milk eggs bread', labels: ['personal'] },
  { id: '2', title: 'Meeting notes', searchText: 'quarterly review', labels: ['work'] },
  { id: '3', title: 'Concatenate example', searchText: 'the cat sat', labels: [] },
  { id: '4', title: 'Recipe', searchText: 'cat food', labels: ['food'] },
];

function indexSearch(query) {
  // Simulate the MiniSearch index behaviour for these fixtures.
  const q = query.toLowerCase();
  const map = {
    cat: ['3', '4'],
    conc: ['3'],
    milk: ['1'],
    quarter: ['2'],
    shopp: ['1'],
  };
  return map[q] || [];
}

describe('matchNoteIdsByQuery', () => {
  it('returns null for an empty query (match everything)', () => {
    expect(matchNoteIdsByQuery(notes, '', indexSearch)).toBeNull();
    expect(matchNoteIdsByQuery(notes, '   ', indexSearch)).toBeNull();
  });

  it('uses the search index for text queries', () => {
    const ids = matchNoteIdsByQuery(notes, 'cat', indexSearch);
    expect([...ids]).toEqual(['3', '4']);
  });

  it('matches labels for # queries without touching the index', () => {
    const ids = matchNoteIdsByQuery(notes, '#work', indexSearch);
    expect([...ids]).toEqual(['2']);
  });

  it('matches partial labels for # queries', () => {
    const ids = matchNoteIdsByQuery(notes, '#wor', indexSearch);
    expect([...ids]).toEqual(['2']);
  });

  it('still returns substring matches when the index throws', () => {
    const failing = () => {
      throw new Error('index not ready');
    };
    const ids = matchNoteIdsByQuery(notes, 'milk', failing);
    expect([...ids]).toEqual(['1']);
  });

  it('matches word endings the prefix-only index cannot find', () => {
    // "view" is a suffix of "review" — the fake index has no entry for it.
    const ids = matchNoteIdsByQuery(notes, 'view', indexSearch);
    expect([...ids]).toEqual(['2']);
  });

  it('matches substrings inside titles', () => {
    const ids = matchNoteIdsByQuery(notes, 'caten', indexSearch);
    expect([...ids]).toEqual(['3']);
  });

  it('combines index hits with substring hits', () => {
    // "cat" hits the index (3, 4); "cat food" substring only matches 4.
    const ids = matchNoteIdsByQuery(notes, 'cat food', indexSearch);
    expect([...ids]).toEqual(['4']);
  });

  it('skips locked notes in the substring pass', () => {
    const locked = [
      ...notes,
      { id: '5', title: 'Secret', searchText: 'hidden passphrase', labels: [], isLocked: true },
    ];
    const ids = matchNoteIdsByQuery(locked, 'passphrase', indexSearch);
    expect(ids.has('5')).toBe(false);
  });

  it('normalizes case-insensitively', () => {
    const ids = matchNoteIdsByQuery(notes, 'CAT', indexSearch);
    expect([...ids]).toEqual(['3', '4']);
  });
});
