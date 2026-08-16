import { describe, it, expect, vi, beforeEach } from 'vitest';

const storage = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};
const appendBatch = vi.fn(async () => {});
const syncNoteMeta = vi.fn();
const removeNoteMeta = vi.fn();

vi.mock('@/lib/storage', () => ({
  useStorage: () => storage,
}));
vi.mock('@/lib/yjs/workspace-doc.js', () => ({
  syncNoteMeta,
  removeNoteMeta,
}));
vi.mock('@/lib/native/yjs.js', () => ({
  appendBatch,
}));
vi.mock('@/lib/yjs/helpers.js', () => ({
  ensureSchema: vi.fn(async () => ({})),
  getDeviceId: vi.fn(() => 'device-1'),
}));
vi.mock('@/utils/crypto/encryption.js', () => ({
  isAppEncryptedEnvelope: vi.fn(() => false),
  decryptContent: vi.fn(async (c) => c),
}));
vi.mock('@/utils/note/serializer.js', () => ({
  extractTextFromContent: vi.fn(() => 'text'),
  stripTransientFields: vi.fn((n) => {
    const { content: _content, ...rest } = n;
    return { ...rest };
  }),
}));

// Deterministic fake doc: any non-empty content yields a non-empty update.
vi.mock('@tiptap/y-tiptap', () => ({
  prosemirrorJSONToYDoc: vi.fn(() => ({
    getXmlFragment: () => ({ length: 1 }),
  })),
}));
vi.mock('yjs', () => ({
  encodeStateAsUpdate: vi.fn(() => new Uint8Array([1, 2, 3])),
}));

const { migrateNotesContent } = await import('../yjs-migration.js');

describe('migrateNotesContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('repairs an invalid URL note id to a nanoid and re-keys the KV row', async () => {
    const badId = 'http://localhost:5173/#/note/87SoE3aP3cO0-K09iV-Y0';
    storage.get.mockResolvedValue({
      [badId]: { id: '', title: 'ghost', content: { type: 'doc', content: [] }, createdAt: 1 },
    });

    const result = await migrateNotesContent();

    expect(result.repaired).toBe(1);
    expect(storage.set).toHaveBeenCalledWith(expect.stringMatching(/^notes\.[A-Za-z0-9_-]{21}$/), expect.objectContaining({ id: expect.any(String) }));
    expect(storage.delete).toHaveBeenCalledWith(`notes.${badId}`);
    expect(appendBatch).toHaveBeenCalledTimes(1);
    // The migrated note uses the repaired id, not the URL.
    const repairedKey = storage.set.mock.calls[0][0];
    expect(repairedKey).not.toContain('http');
    // The workspace doc is re-keyed too, so writeStoresFromWorkspace hydrates
    // the note with a real id (otherwise the notes getter filters it out and
    // the grid shows EmptyState even though the note migrated).
    expect(removeNoteMeta).toHaveBeenCalledWith(badId);
    expect(syncNoteMeta).toHaveBeenCalledTimes(1);
    expect(syncNoteMeta.mock.calls[0][0].id).toMatch(/^[A-Za-z0-9_-]{21}$/);
  });

  it('is re-runnable and converts remaining KV notes on a later run', async () => {
    const noteA = { id: 'noteA', content: { type: 'doc', content: [] }, createdAt: 1 };
    const noteB = { id: 'noteB', content: { type: 'doc', content: [] }, createdAt: 2 };

    // First run: noteB is password-locked and must stay in KV.
    storage.get.mockResolvedValueOnce({ noteA: noteA, noteB: { ...noteB, isLocked: true } });

    const first = await migrateNotesContent();
    expect(first.migrated).toBe(1); // noteA converted, locked noteB skipped
    expect(storage.delete).not.toHaveBeenCalled();

    // Second run: noteA no longer has KV content (converted); the locked note
    // remains in KV for a future unlock, and migration still completes.
    storage.get.mockResolvedValueOnce({ noteB: { ...noteB, isLocked: true } });
    const second = await migrateNotesContent();
    expect(second.migrated).toBe(0);
  });
});
