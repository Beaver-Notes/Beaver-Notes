import { describe, it, expect, vi, beforeEach } from 'vitest';

const storageGet = vi.fn(async () => ({
  n1: { id: 'n1', title: 'one', updatedAt: 10 },
  n2: { id: 'n2', title: 'two', updatedAt: 20 },
}));
const buildSearchIndex = vi.fn();
const rebuildLinkIndexFromAll = vi.fn();
const getSearchIndexJSON = vi.fn(() => '{"search":1}');
const getLinkIndexJSON = vi.fn(() => '{"links":1}');
const indexSave = vi.fn(async () => {});
const migrateAssetEncryption = vi.fn(async () => {});

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

import {
  buildImportedSearchIndex,
  secureImportedAssets,
} from '../import-finalize.js';

describe('buildImportedSearchIndex', () => {
  beforeEach(() => {
    buildSearchIndex.mockClear();
    rebuildLinkIndexFromAll.mockClear();
    indexSave.mockClear();
  });

  it('builds the search and link indexes from the imported KV notes', async () => {
    await buildImportedSearchIndex();
    expect(storageGet).toHaveBeenCalledWith('notes', {});
    expect(buildSearchIndex).toHaveBeenCalledWith({
      n1: { id: 'n1', title: 'one', updatedAt: 10 },
      n2: { id: 'n2', title: 'two', updatedAt: 20 },
    });
    expect(rebuildLinkIndexFromAll).toHaveBeenCalledTimes(1);
  });

  it('persists the indexes with per-note signatures', async () => {
    await buildImportedSearchIndex();
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
