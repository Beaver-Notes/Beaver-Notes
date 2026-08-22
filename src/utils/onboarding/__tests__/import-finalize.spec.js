import { describe, it, expect, vi, beforeEach } from 'vitest';

const storageGet = vi.fn(async () => ({
  kv: { id: 'kv', title: 'from-kv', updatedAt: 99 },
}));
const buildSearchIndex = vi.fn();
const rebuildLinkIndexFromAll = vi.fn();
const getSearchIndexJSON = vi.fn(() => '{"search":1}');
const getLinkIndexJSON = vi.fn(() => '{"links":1}');
const indexSave = vi.fn(async () => {});
const migrateAssetEncryption = vi.fn(async () => {});
const useNoteStore = vi.fn(() => ({
  data: {
    n1: { id: 'n1', title: 'one', updatedAt: 10 },
    n2: { id: 'n2', title: 'two', updatedAt: 20 },
  },
}));

vi.mock('@/lib/storage', () => ({
  useStorage: () => ({ get: storageGet }),
}));
vi.mock('@/utils/note/search.js', () => ({
  buildSearchIndex,
  getSearchIndexJSON,
}));
vi.mock('@/store/note/backlinks.ts', () => ({
  rebuildLinkIndexFromAll,
  getLinkIndexJSON,
}));
vi.mock('@/lib/tauri/bindings', () => ({
  commands: { indexSave },
}));
vi.mock('@/lib/native/security.js', () => ({ migrateAssetEncryption }));
vi.mock('@/store/note', () => ({ useNoteStore }));

import {
  buildImportedSearchIndex,
  secureImportedAssets,
} from '../import-finalize.js';

const notes = {
  n1: { id: 'n1', title: 'one', updatedAt: 10 },
  n2: { id: 'n2', title: 'two', updatedAt: 20 },
};

describe('buildImportedSearchIndex', () => {
  beforeEach(() => {
    storageGet.mockClear();
    buildSearchIndex.mockClear();
    rebuildLinkIndexFromAll.mockClear();
    indexSave.mockClear();
    useNoteStore.mockClear();
  });

  it('builds the search and link indexes from the provided notes, not KV', async () => {
    await buildImportedSearchIndex(notes);
    expect(buildSearchIndex).toHaveBeenCalledWith(notes);
    expect(rebuildLinkIndexFromAll).toHaveBeenCalledWith(notes);
    expect(useNoteStore).not.toHaveBeenCalled();
  });

  it('falls back to the in-memory note store when no notes are provided', async () => {
    await buildImportedSearchIndex();
    expect(useNoteStore).toHaveBeenCalledTimes(1);
    expect(buildSearchIndex).toHaveBeenCalledWith(notes);
    expect(rebuildLinkIndexFromAll).toHaveBeenCalledTimes(1);
  });

  it('persists the indexes with per-note signatures', async () => {
    await buildImportedSearchIndex(notes);
    expect(indexSave).toHaveBeenCalledWith(
      '{"search":1}',
      '{"links":1}',
      JSON.stringify({ n1: 10, n2: 20 })
    );
  });
});

describe('secureImportedAssets', () => {
  it('re-encrypts imported assets via migrateAssetEncryption', async () => {
    await secureImportedAssets();
    expect(migrateAssetEncryption).toHaveBeenCalledTimes(1);
  });
});
