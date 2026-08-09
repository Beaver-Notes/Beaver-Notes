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

  it('falls back to null when the index throws (caller does a linear scan)', () => {
    const failing = () => {
      throw new Error('index not ready');
    };
    expect(matchNoteIdsByQuery(notes, 'milk', failing)).toBeNull();
  });

  it('normalizes case-insensitively', () => {
    const ids = matchNoteIdsByQuery(notes, 'CAT', indexSearch);
    expect([...ids]).toEqual(['3', '4']);
  });
});
