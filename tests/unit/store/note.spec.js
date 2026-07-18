// tests/unit/store/note.spec.js
import { describe, it, expect, vi } from 'vitest';
import { invokeCommand } from '@/lib/tauri/commands';
import { useNoteStore } from '@/store/note';

vi.mock('@/lib/native/search', () => ({
  indexNote: vi.fn((id, title, body) => invokeCommand('search:indexNote', { id, title, body })),
  removeNoteFromIndex: vi.fn(() => Promise.resolve()),
  searchNotesFts: vi.fn(() => Promise.resolve({ ids: [] })),
}));

import { saveNote } from '@/store/note/index';
import { indexNote } from '@/lib/native/search';

describe('note store', () => {
  beforeEach(() => {
    vi.mocked(indexNote).mockClear();
  });

  it('starts with empty note data', () => {
    const store = useNoteStore();
    expect(store.data).toEqual({});
    expect(store.syncInProgress).toBe(false);
  });

  it('adds a note and persists it through the IPC bridge', async () => {
    const store = useNoteStore();
    const note = await store.add({ title: 'Hello' });
    expect(note.id).toBeTruthy();
    expect(store.data[note.id].title).toBe('Hello');
    // saveNote -> FTS index -> search:indexNote invokeCommand
    expect(invokeCommand).toHaveBeenCalledWith('search:indexNote', expect.any(Object));
  });

  it('saveNote indexes an unlocked note via indexNote', async () => {
    const { indexNote } = await import('@/lib/native/search');
    const note = { id: 'n1', title: 'T', searchText: 'body', isLocked: false, content: 'x' };
    await saveNote('n1', note);
    expect(indexNote).toHaveBeenCalledWith('n1', 'T', 'body');
  });

  it('saveNote skips FTS indexing for a locked note', async () => {
    const { indexNote } = await import('@/lib/native/search');
    const note = { id: 'n2', title: 'T', searchText: 'body', isLocked: true, content: 'x' };
    await saveNote('n2', note);
    expect(indexNote).not.toHaveBeenCalled();
  });
});
