import { describe, it, expect, vi, beforeEach } from 'vitest';
import { insertAudioIntoClosedNote } from '../audioInsert.js';

beforeEach(() => vi.clearAllMocks());

vi.mock('@/lib/tauri-bridge', () => ({ path: { basename: (f) => f.split('/').pop() } }));
vi.mock('@/lib/native/fs', () => ({ removePath: vi.fn() }));
const replaceNoteContentInYjs = vi.fn();
vi.mock('@/utils/note/contentToYjs.js', () => ({ replaceNoteContentInYjs }));

function noteStore(content) {
  return {
    getById: vi.fn(() => ({ id: 'n1', content })),
    patchLocal: vi.fn(),
    persist: vi.fn(),
  };
}

describe('insertAudioIntoClosedNote cursor mapping', () => {
  it('inserts the audio node at the paragraph boundary that matches cursorPos', async () => {
    const content = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
    ] };
    const store = noteStore(content);
    await insertAudioIntoClosedNote('n1', '/a/assets/n1/rec.wav', store, 4);
    const written = store.patchLocal.mock.calls[0][1].content;
    // cursor 4 = end of first paragraph -> audio node between the two paragraphs.
    expect(written.content[1].type).toBe('Audio');
  });

  it('appends the audio node at the end when cursorPos is null', async () => {
    const content = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
    ] };
    const store = noteStore(content);
    await insertAudioIntoClosedNote('n1', '/a/assets/n1/rec.wav', store);
    const written = store.patchLocal.mock.calls[0][1].content;
    expect(written.content).toHaveLength(3);
    expect(written.content[2].type).toBe('Audio');
  });

  it('replaces the Yjs content via compact, not append, so it is not duplicated', async () => {
    const content = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
    ] };
    const store = noteStore(content);
    await insertAudioIntoClosedNote('n1', '/a/assets/n1/rec.wav', store);
    expect(replaceNoteContentInYjs).toHaveBeenCalledTimes(1);
    const [noteId, written] = replaceNoteContentInYjs.mock.calls[0];
    expect(noteId).toBe('n1');
    expect(written.content).toHaveLength(2);
    expect(written.content[1].type).toBe('Audio');
    expect(written.content[0]).toEqual(content.content[0]);
  });
});
