// tests/unit/store/note.spec.js
import { describe, it, expect } from 'vitest';
import { invokeCommand } from '@/lib/tauri/commands';
import { useNoteStore } from '@/store/note';

describe('note store', () => {
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
});
