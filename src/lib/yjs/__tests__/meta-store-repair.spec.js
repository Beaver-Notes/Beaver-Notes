import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';

const { docHolder, native } = vi.hoisted(() => ({
  docHolder: { doc: null },
  native: {
    getSnapshots: vi.fn(),
    appendBatch: vi.fn(),
  },
}));

vi.mock('@/lib/native/yjs.js', () => ({
  getSnapshots: native.getSnapshots,
  appendBatch: native.appendBatch,
}));
vi.mock('@/lib/yjs/meta-doc.js', () => ({
  getWorkspaceDoc: () => docHolder.doc,
  onWorkspaceDocDestroy: vi.fn(),
}));
vi.mock('@/lib/yjs/helpers.js', () => ({
  getDeviceId: () => 'device',
  yMapToObj: (map) => {
    const out = {};
    for (const [k, v] of map.entries()) out[k] = v;
    return out;
  },
  toUint8Array: (d) => d,
}));
vi.mock('@/lib/yjs/workspace-doc.js', () => ({
  removeNoteMeta: vi.fn(),
  syncNoteMeta: vi.fn(),
}));
vi.mock('@/store/folder', () => ({ useFolderStore: () => ({ data: {}, _rebuildIndex: vi.fn() }) }));
vi.mock('@/store/label', () => ({ useLabelStore: () => ({ data: [], colors: {} }) }));
vi.mock('@/store/note', () => ({ useNoteStore: () => ({ data: {}, deletedIds: {} }) }));
vi.mock('@/store/note/index', () => ({ saveNote: vi.fn(), syncSearchIndex: vi.fn() }));

import { repairStrandedNotes } from '@/lib/yjs/meta-store.js';
import { removeNoteMeta } from '@/lib/yjs/workspace-doc.js';

describe('repairStrandedNotes (L3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    docHolder.doc = new Y.Doc();
    native.getSnapshots.mockResolvedValue({});
    native.appendBatch.mockResolvedValue(undefined);
  });

  it('does not drop an untitled note whose snapshot has not arrived yet', async () => {
    const note = new Y.Map();
    note.set('id', 'n1');
    note.set('title', '');
    docHolder.doc.getMap('notes').set('n1', note);

    const result = await repairStrandedNotes();

    expect(removeNoteMeta).not.toHaveBeenCalled();
    expect(result.dropped).toBe(0);
    expect(docHolder.doc.getMap('notes').has('n1')).toBe(true);
  });
});
