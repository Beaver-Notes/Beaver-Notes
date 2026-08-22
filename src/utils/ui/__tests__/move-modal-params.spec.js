import { describe, it, expect } from 'vitest';
import { resolveMoveModalParams } from '../move-modal-params.js';

describe('resolveMoveModalParams', () => {
  const note = { id: 'n1' };

  it('returns the single note in note mode when moveTarget is set', () => {
    expect(resolveMoveModalParams(note, [], [], null)).toEqual({
      notes: [note],
      folders: [],
      mode: 'note',
    });
  });

  it('returns the bulk selection when no moveTarget is set', () => {
    const selectedNotes = [{ id: 'a' }];
    const selectedFolders = [{ id: 'f' }];
    expect(resolveMoveModalParams(null, selectedNotes, selectedFolders, 'folder')).toEqual({
      notes: selectedNotes,
      folders: selectedFolders,
      mode: 'folder',
    });
  });
});
