import { setActivePinia, createPinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import { rebuildLinkIndexForNote } from '@/store/note/backlinks';
import { syncNoteMeta } from '@/lib/yjs/workspace-doc';

describe('deferred derived flush', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  function bigContent(paragraphs: number) {
    const content: any = { type: 'doc', content: [] };
    for (let i = 0; i < paragraphs; i++) {
      content.content.push({ type: 'paragraph', content: [{ type: 'text', text: 'line ' + i }] });
    }
    return content;
  }

  it('updates preview/searchText/link-index/meta after the deferred flush', async () => {
    vi.useFakeTimers();
    const store = useNoteStore();
    store.data['note-big'] = {
      id: 'note-big',
      title: 'Big',
      content: bigContent(2100),
      labels: [],
      createdAt: 1,
      updatedAt: 1,
      isBookmarked: false,
      isArchived: false,
      isLocked: false,
      isFullWidth: false,
      folderId: null,
    };

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
    vi.useFakeTimers();
    const store = useNoteStore();
    store.data['note-locked'] = {
      id: 'note-locked',
      title: 'Locked',
      content: bigContent(2100),
      labels: [],
      createdAt: 1,
      updatedAt: 1,
      isBookmarked: false,
      isArchived: false,
      isLocked: true,
      isFullWidth: false,
      folderId: null,
    };

    await store.persist('note-locked');
    await vi.advanceTimersByTimeAsync(1600);

    // Derived data must never be fabricated for a locked note.
    expect(store.data['note-locked'].preview).toBeUndefined();
    expect(store.data['note-locked'].searchText).toBeUndefined();
  });
});
