import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildSearchIndex,
  clearSearchIndex,
  getSearchIndexJSON,
  loadSearchIndex,
  removeSearchEntry,
  searchNotesIndex,
  upsertSearchEntry,
} from '@/composable/useSearch.js';

describe('useSearch', () => {
  beforeEach(() => {
    clearSearchIndex();
  });

  it('finds notes by title, body, and labels', () => {
    buildSearchIndex({
      a: {
        id: 'a',
        title: 'Apple Pie',
        searchText: 'classic dessert recipe',
        labels: ['Food'],
      },
      b: {
        id: 'b',
        title: 'Garden Journal',
        searchText: 'tomatoes and basil',
        labels: ['Home', 'Plants'],
      },
      c: {
        id: 'c',
        title: 'Vue Notes',
        searchText: 'search index integration',
        labels: ['Coding', 'Recipe'],
      },
    });

    expect(searchNotesIndex('apple')).toEqual(['a']);
    expect(searchNotesIndex('basil')).toEqual(['b']);
    expect(searchNotesIndex('recipe')).toEqual(expect.arrayContaining(['a', 'c']));
  });

  it('updates and removes entries in place', () => {
    upsertSearchEntry({
      id: 'a',
      title: 'First Draft',
      searchText: 'old content',
      labels: [],
    });

    expect(searchNotesIndex('first')).toEqual(['a']);

    upsertSearchEntry({
      id: 'a',
      title: 'Second Draft',
      searchText: 'new content',
      labels: ['Updated'],
    });

    expect(searchNotesIndex('first')).toEqual([]);
    expect(searchNotesIndex('second')).toEqual(['a']);
    expect(searchNotesIndex('updated')).toEqual(['a']);

    removeSearchEntry('a');
    expect(searchNotesIndex('second')).toEqual([]);
  });

  it('round-trips the index through the persisted JSON format', () => {
    buildSearchIndex({
      a: {
        id: 'a',
        title: 'Apple Pie',
        searchText: 'classic dessert recipe',
        labels: ['Food'],
      },
      b: {
        id: 'b',
        title: 'Garden Journal',
        searchText: 'tomatoes and basil',
        labels: ['Home'],
      },
    });

    const json = getSearchIndexJSON();
    clearSearchIndex();
    expect(searchNotesIndex('dessert')).toEqual([]);

    loadSearchIndex(json);
    expect(searchNotesIndex('dessert')).toEqual(['a']);
    expect(searchNotesIndex('garden')).toEqual(['b']);
  });
});
