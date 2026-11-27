import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@/utils/note/search.js', () => ({
  upsertSearchEntry: vi.fn(),
  removeSearchEntry: vi.fn(),
  searchNotesIndex: vi.fn(() => Promise.resolve({ ids: [] })),
  buildSearchIndex: vi.fn(),
  getSearchIndexJSON: vi.fn(() => Promise.resolve('{}')),
  loadSearchIndex: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@/utils/platform/spotlightSync.js', () => ({
  indexNoteForSpotlight: vi.fn(),
  deleteNoteFromSpotlight: vi.fn(),
  reindexAllNotes: vi.fn(),
}));

import { useNoteStore } from '@/store/note';
import { saveNote } from '@/store/note/index';
import { upsertSearchEntry } from '@/utils/note/search.js';
import { indexNoteForSpotlight } from '@/utils/platform/spotlightSync.js';

describe('note store', () => {
  beforeAll(() => {
    setActivePinia(createPinia());
  });

  beforeEach(() => {
    vi.mocked(upsertSearchEntry).mockClear();
    vi.mocked(indexNoteForSpotlight).mockClear();
  });

  it('starts with empty note data', () => {
    const store = useNoteStore();
    expect(store.data).toEqual({});
    expect(store.syncInProgress).toBe(false);
  });

  it('saveNote indexes an unlocked note', async () => {
    await saveNote('n1', {
      id: 'n1',
      title: 'T',
      searchText: 'body',
      isLocked: false,
      content: 'x',
    });
    expect(upsertSearchEntry).toHaveBeenCalled();
    expect(indexNoteForSpotlight).toHaveBeenCalled();
  });

  // Privacy guard: a locked note's body must never reach the local search index.
  it('saveNote skips FTS indexing for a locked note', async () => {
    await saveNote('n2', {
      id: 'n2',
      title: 'T',
      searchText: 'body',
      isLocked: true,
      content: 'x',
    });
    expect(upsertSearchEntry).not.toHaveBeenCalled();
  });
});
