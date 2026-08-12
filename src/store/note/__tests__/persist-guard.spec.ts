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
}));

vi.mock('@/utils/note/search.js', () => ({
  buildSearchIndex: vi.fn(),
  removeSearchEntry: vi.fn(),
  searchNotesIndex: vi.fn(),
  upsertSearchEntry: vi.fn(),
}));

vi.mock('@/utils/platform/spotlightSync.js', () => ({
  indexNoteForSpotlight: vi.fn(),
  reindexAllNotes: vi.fn(),
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

vi.mock('@/utils/sync', () => ({
  trackDeletedAssets: vi.fn(),
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
  uncollapseHeading: vi.fn(),
  migrateLockData: vi.fn(),
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

describe('persist guard – dirty-signature optimization', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
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

  it('first persist: all work done', async () => {
    const content = { type: 'doc', content: [] };
    const store = createNote('note-1', content, 'Test Note');

    await store.persist('note-1');

    expect(buildNotePreview).toHaveBeenCalled();
    expect(extractTextFromContent).toHaveBeenCalledWith(content);
    expect(rebuildLinkIndexForNote).toHaveBeenCalledWith('note-1', content);
    expect(upsertSearchEntry).toHaveBeenCalled();
    expect(indexNoteForSpotlight).toHaveBeenCalled();
    expect(syncNoteMeta).toHaveBeenCalled();
  });

  it('title-only persist: preview skipped but search re-indexed', async () => {
    const content = { type: 'doc', content: [] };
    const store = createNote('note-1', content, 'Original Title');
    await store.persist('note-1');

    vi.clearAllMocks();

    store.patchLocal('note-1', { title: 'New Title' });
    await store.persist('note-1');

    expect(buildNotePreview).not.toHaveBeenCalled();
    expect(extractTextFromContent).not.toHaveBeenCalled();
    expect(upsertSearchEntry).toHaveBeenCalled();
    expect(indexNoteForSpotlight).toHaveBeenCalled();
  });

  it('content change persist: full work', async () => {
    const content1 = { type: 'doc', content: [] };
    const store = createNote('note-1', content1, 'Test');
    await store.persist('note-1');

    vi.clearAllMocks();

    const content2 = { type: 'doc', content: [{ type: 'paragraph' }] };
    store.patchLocal('note-1', { content: content2 });
    await store.persist('note-1');

    expect(buildNotePreview).toHaveBeenCalled();
    expect(extractTextFromContent).toHaveBeenCalledWith(content2);
    expect(rebuildLinkIndexForNote).toHaveBeenCalledWith('note-1', content2);
    expect(upsertSearchEntry).toHaveBeenCalled();
    expect(indexNoteForSpotlight).toHaveBeenCalled();
  });

  it('labels change: saveNote called', async () => {
    const content = { type: 'doc', content: [] };
    const store = createNote('note-1', content, 'Test', []);
    await store.persist('note-1');

    vi.clearAllMocks();

    store.patchLocal('note-1', { labels: ['label-1'] });
    await store.persist('note-1');

    expect(upsertSearchEntry).toHaveBeenCalled();
    expect(indexNoteForSpotlight).toHaveBeenCalled();
  });

  it('no-change persist: all work skipped', async () => {
    const content = { type: 'doc', content: [] };
    const store = createNote('note-1', content, 'Title');
    await store.persist('note-1');

    vi.clearAllMocks();

    await store.persist('note-1');

    expect(buildNotePreview).not.toHaveBeenCalled();
    expect(extractTextFromContent).not.toHaveBeenCalled();
    expect(upsertSearchEntry).not.toHaveBeenCalled();
    expect(indexNoteForSpotlight).not.toHaveBeenCalled();
    expect(rebuildLinkIndexForNote).not.toHaveBeenCalled();
  });
});
