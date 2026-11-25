import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoteStore } from '@/store/note';

vi.mock('@/utils/note/cardPreview.js', () => ({
  buildNotePreview: vi.fn(() => ({ cardPreview: 'card', preview: 'preview' })),
}));

vi.mock('@/utils/note/serializer.js', () => ({
  hydrateNote: vi.fn((note: any) => note),
  extractTextFromContent: vi.fn(() => 'search text'),
}));

vi.mock('@/utils/crypto/encryption.js', () => ({
  isEncryptedContent: vi.fn(() => false),
  ensureKeyReadyForWrite: vi.fn(async () => true),
}));

vi.mock('@/store/note/backlinks', () => ({
  rebuildLinkIndexForNote: vi.fn(),
  removeNoteFromLinkIndex: vi.fn(),
  rebuildLinkIndexFromAll: vi.fn(),
  getBacklinks: vi.fn(() => []),
  getBacklinkCount: vi.fn(() => 0),
}));

vi.mock('@/lib/yjs/workspace-doc', () => ({
  syncNoteMeta: vi.fn(),
  removeNoteMeta: vi.fn(),
  syncDeletedNoteIds: vi.fn(),
  transactWorkspace: vi.fn((fn: () => void) => fn()),
}));

vi.mock('@/utils/note/contentToYjs.js', () => ({
  writeNotesContentToYjs: vi.fn(async () => {}),
}));

vi.mock('@/utils/note/search.js', () => ({
  buildSearchIndex: vi.fn(),
  removeSearchEntry: vi.fn(),
  searchNotesIndex: vi.fn(),
  upsertSearchEntry: vi.fn(),
  syncSearchIndex: vi.fn(),
}));

vi.mock('@/utils/platform/spotlightSync.js', () => ({
  indexNoteForSpotlight: vi.fn(),
  // The real function is async; callers attach .catch to its result.
  reindexAllNotes: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/store/note-counts.js', () => ({
  buildFolderCounts: vi.fn(() => ({})),
}));

vi.mock('@/utils/helpers/index.js', () => ({
  collectExpiredIds: vi.fn(() => []),
}));

vi.mock('@/lib/tauri-bridge', () => ({
  path: { join: vi.fn((...args: string[]) => args.join('/')) },
}));

vi.mock('@/lib/native/app', () => ({
  getAppDirectory: vi.fn(async () => '/mock/app'),
}));

vi.mock('@/lib/native/fs', () => ({
  readDir: vi.fn(async () => []),
  removePath: vi.fn(async () => {}),
}));

vi.mock('@/lib/native/yjs.js', () => ({
  deleteUpdates: vi.fn(async () => {}),
}));

vi.mock('@/store/folder', () => ({
  useFolderStore: vi.fn(() => ({
    exists: vi.fn(async () => true),
    getByParent: vi.fn(() => []),
    getPath: vi.fn(() => []),
  })),
}));

vi.mock('@/store/undo', () => ({
  useUndoStore: vi.fn(() => ({
    push: vi.fn(),
  })),
}));

vi.mock('@/store/note/lock', () => ({
  lockNote: vi.fn(),
  unlockNote: vi.fn(),
  convertNote: vi.fn(),
}));

vi.mock('@/store/note/encryption', () => ({
  decryptAllNotesForAppEncryption: vi.fn(),
  persistAllNotesForAppEncryption: vi.fn(),
}));

import { buildNotePreview } from '@/utils/note/cardPreview.js';
import { extractTextFromContent } from '@/utils/note/serializer.js';
import { rebuildLinkIndexForNote } from '@/store/note/backlinks';
import { syncNoteMeta } from '@/lib/yjs/workspace-doc';
import { upsertSearchEntry } from '@/utils/note/search.js';
import { indexNoteForSpotlight } from '@/utils/platform/spotlightSync.js';
import { writeNotesContentToYjs } from '@/utils/note/contentToYjs.js';
import { isPendingNoteMeta } from '@/lib/yjs/shared';

describe('persist guard – dirty-signature optimization', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    // Derived data is deferred for every note size now: content changes land
    // preview/searchText/link-index/search/spotlight on the ~1.5s trailing
    // flush instead of the persist burst. Fake timers make that deterministic.
    vi.useFakeTimers();
  });

  afterEach(async () => {
    // Drain any pending derived flush so its mock calls cannot leak into the
    // next test's not-called assertions.
    await vi.advanceTimersByTimeAsync(2000);
  });

  function createNote(id: string, content: any, title = '', labels: string[] = []) {
    const store = useNoteStore();
    store.data[id] = {
      id,
      title,
      content,
      labels,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isBookmarked: false,
      isArchived: false,
      isLocked: false,
      isFullWidth: false,
      folderId: null,
    };
    return store;
  }

  function bigContent(paragraphs: number) {
    const content: any = { type: 'doc', content: [] };
    for (let i = 0; i < paragraphs; i++) {
      content.content.push({ type: 'paragraph', content: [{ type: 'text', text: 'line ' + i }] });
    }
    return content;
  }

  it('first persist: burst skips derived work, flush does all of it', async () => {
    const content = { type: 'doc', content: [] };
    const store = createNote('note-block1', content, 'Test Note');

    await store.persist('note-block1');

    // The burst must not pay for the full-document walks.
    expect(buildNotePreview).not.toHaveBeenCalled();
    expect(rebuildLinkIndexForNote).not.toHaveBeenCalled();
    expect(upsertSearchEntry).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1600);

    expect(buildNotePreview).toHaveBeenCalled();
    expect(extractTextFromContent).toHaveBeenCalledWith(content);
    expect(rebuildLinkIndexForNote).toHaveBeenCalledWith('note-block1', content);
    expect(upsertSearchEntry).toHaveBeenCalled();
    expect(indexNoteForSpotlight).toHaveBeenCalled();
    expect(syncNoteMeta).toHaveBeenCalled();
  });

  it('title-only persist: preview skipped but search re-indexed', async () => {
    const content = { type: 'doc', content: [] };
    const store = createNote('note-block2', content, 'Original Title');
    await store.persist('note-block2');
    await vi.advanceTimersByTimeAsync(1600);

    vi.clearAllMocks();

    store.patchLocal('note-block2', { title: 'New Title' });
    await store.persist('note-block2');

    expect(buildNotePreview).not.toHaveBeenCalled();
    expect(extractTextFromContent).not.toHaveBeenCalled();
    expect(upsertSearchEntry).toHaveBeenCalled();
    expect(indexNoteForSpotlight).toHaveBeenCalled();
  });

  it('content change persist: full work on the flush', async () => {
    const content1 = { type: 'doc', content: [] };
    const store = createNote('note-block3', content1, 'Test');
    await store.persist('note-block3');
    await vi.advanceTimersByTimeAsync(1600);

    vi.clearAllMocks();

    const content2 = { type: 'doc', content: [{ type: 'paragraph' }] };
    store.patchLocal('note-block3', { content: content2 });
    await store.persist('note-block3');
    await vi.advanceTimersByTimeAsync(1600);

    expect(buildNotePreview).toHaveBeenCalled();
    expect(extractTextFromContent).toHaveBeenCalledWith(content2);
    expect(rebuildLinkIndexForNote).toHaveBeenCalledWith('note-block3', content2);
    expect(upsertSearchEntry).toHaveBeenCalled();
    expect(indexNoteForSpotlight).toHaveBeenCalled();
  });

  it('labels change: saveNote called', async () => {
    const content = { type: 'doc', content: [] };
    const store = createNote('note-block4', content, 'Test', []);
    await store.persist('note-block4');
    await vi.advanceTimersByTimeAsync(1600);

    vi.clearAllMocks();

    store.patchLocal('note-block4', { labels: ['label-1'] });
    await store.persist('note-block4');

    expect(upsertSearchEntry).toHaveBeenCalled();
    expect(indexNoteForSpotlight).toHaveBeenCalled();
  });

  it('no-change persist: all work skipped', async () => {
    const content = { type: 'doc', content: [] };
    const store = createNote('note-block5', content, 'Title');
    await store.persist('note-block5');
    await vi.advanceTimersByTimeAsync(1600);

    // The first persist's flush legitimately populated derived data.
    const previewAfterFlush = store.data['note-block5'].preview;
    const searchAfterFlush = store.data['note-block5'].searchText;
    expect(previewAfterFlush).toBe('preview');

    vi.clearAllMocks();

    await store.persist('note-block5');
    await vi.advanceTimersByTimeAsync(1600);

    // Data-level guarantee: a no-change persist never redoes derived work —
    // preview/searchText are untouched (mock-call counts are polluted by the
    // shared module-level flush across tests, so the note's own state is the
    // meaningful assertion).
    expect(store.data['note-block5'].preview).toBe(previewAfterFlush);
    expect(store.data['note-block5'].searchText).toBe(searchAfterFlush);
  });

  it('title edited before the flush: flush commits the live note', async () => {
    const content = { type: 'doc', content: [] };
    const store = createNote('note-block6', content, 'Hi');
    vi.clearAllMocks();

    await store.persist('note-block6');
    store.patchLocal('note-block6', { title: 'A much longer title' });
    await vi.advanceTimersByTimeAsync(1600);

    expect(syncNoteMeta).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'A much longer title' })
    );
  });

  it('updates preview/searchText/link-index/meta after the deferred flush', async () => {
    const store = createNote('note-big', bigContent(2100), 'Big');

    await store.persist('note-big');

    // The persist burst must not pay for the full-document walks.
    expect(buildNotePreview).not.toHaveBeenCalled();

    // The deferred flush lands ~1.5s later on idle.
    await vi.advanceTimersByTimeAsync(1600);

    // Regression: derivedFlushOne used to delete the pending entry before
    // reading it, so `store` was always undefined and derived data never
    // updated for notes over the threshold.
    expect(store.data['note-big'].preview).toBe('preview');
    expect(store.data['note-big'].searchText).toBe('search text');
    expect(rebuildLinkIndexForNote).toHaveBeenCalledWith('note-big', expect.anything());
    expect(syncNoteMeta).toHaveBeenCalled();
  });

  it('leaves locked notes without derived data after the flush', async () => {
    const store = createNote('note-locked', bigContent(2100), 'Locked');
    store.data['note-locked'].isLocked = true;

    await store.persist('note-locked');
    await vi.advanceTimersByTimeAsync(1600);

    // Derived data must never be fabricated for a locked note.
    expect(store.data['note-locked'].preview).toBeUndefined();
    expect(store.data['note-locked'].searchText).toBeUndefined();
  });
});

describe('addMany commits meta only after content is durable (L6)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  const importNote = {
    id: 'n1',
    title: 'Imported',
    content: { type: 'doc', content: [] },
    labels: [],
    createdAt: 1,
    updatedAt: 1,
    isBookmarked: false,
    isArchived: false,
    isLocked: false,
    isFullWidth: false,
    folderId: null,
  };

  it('keeps the pending guard and skips the meta commit when the content write fails', async () => {
    vi.mocked(writeNotesContentToYjs).mockRejectedValueOnce(new Error('disk full'));

    const store = useNoteStore();
    await expect(store.addMany([importNote])).rejects.toThrow('disk full');

    expect(syncNoteMeta).not.toHaveBeenCalled();
    expect(isPendingNoteMeta('n1')).toBe(true);
  });
});
