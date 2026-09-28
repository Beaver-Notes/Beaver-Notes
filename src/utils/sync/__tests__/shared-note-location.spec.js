import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/tauri-bridge', () => ({ backend: { invoke: vi.fn() } }));
vi.mock('@/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  _resetSharedNotesCache,
  getSharedNoteList,
  isSharedNote,
  resolveNoteWorkspaceId,
  setSharedNoteList,
} from '../shared-notes.js';

describe('shared note workspace routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    _resetSharedNotesCache();
  });

  it('routes a shared note to its owning workspace and everything else to the fallback', () => {
    setSharedNoteList([{ noteId: 'n1', workspaceId: 'w1' }]);

    expect(isSharedNote('n1')).toBe(true);
    expect(isSharedNote('n2')).toBe(false);
    expect(resolveNoteWorkspaceId('n1', 'active')).toBe('w1');
    expect(resolveNoteWorkspaceId('n2', 'active')).toBe('active');
  });

  it('drops notes no longer shared and reloads the map from storage', () => {
    setSharedNoteList([
      { noteId: 'n1', workspaceId: 'w1' },
      { noteId: 'n2', workspaceId: 'w2' },
    ]);
    setSharedNoteList([{ noteId: 'n2', workspaceId: 'w2' }]);

    expect(getSharedNoteList()).toEqual([{ noteId: 'n2', workspaceId: 'w2' }]);

    _resetSharedNotesCache();
    expect(isSharedNote('n1')).toBe(false);
    expect(resolveNoteWorkspaceId('n2', 'active')).toBe('w2');
  });

  it('ignores rows without an owning workspace id', () => {
    setSharedNoteList([
      { noteId: 'n1', workspaceId: null },
      { noteId: 'n2', workspaceId: 'w2' },
    ]);
    expect(getSharedNoteList()).toEqual([{ noteId: 'n2', workspaceId: 'w2' }]);
  });
});
