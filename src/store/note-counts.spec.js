import { describe, expect, it } from 'vitest';
import { buildFolderCounts } from './note-counts.js';

describe('buildFolderCounts', () => {
  it('counts notes per folder in a single pass', () => {
    const notes = [
      { id: 'n1', folderId: 'a' },
      { id: 'n2', folderId: 'a' },
      { id: 'n3', folderId: null },
      { id: 'n4', folderId: 'b' },
    ];
    expect(buildFolderCounts(notes)).toEqual({ a: 2, b: 1, null: 1 });
  });

  it('excludes notes without an id', () => {
    const notes = [{ folderId: 'a' }, { id: 'x', folderId: 'a' }];
    expect(buildFolderCounts(notes)).toEqual({ a: 1 });
  });

  it('returns an empty object for no notes', () => {
    expect(buildFolderCounts([])).toEqual({});
  });

  it('counts notes without a folderId under the root (null) key', () => {
    const notes = [{ id: 'n1' }, { id: 'n2', folderId: null }];
    expect(buildFolderCounts(notes)).toEqual({ null: 2 });
  });
});
