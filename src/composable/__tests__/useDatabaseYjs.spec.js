import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/native/yjs.js', () => ({
  appendUpdate: vi.fn(),
  getUpdates: vi.fn(() => []),
  getSnapshot: vi.fn(() => null),
  compactUpdates: vi.fn(),
  deleteUpdates: vi.fn(),
}));
vi.mock('@/utils/sync/sync-repository.js', () => ({
  getCommitsDir: vi.fn(() => '/commits'),
}));
vi.mock('@/utils/sync/pending-writes.js', () => ({ queueSyncWrite: vi.fn() }));
vi.mock('@/lib/yjs/helpers.js', () => ({
  getDeviceId: vi.fn(() => 'device'),
  // Faithful-enough stand-ins: tests feed raw Uint8Arrays (native/yjs is
  // mocked), so the base64 normalization in the real helpers is irrelevant.
  toUint8Array: (data) => (data instanceof Uint8Array ? data : new Uint8Array(data ?? [])),
  applyUpdatesToDoc: (doc, updates) => {
    for (const u of updates || []) Y.applyUpdate(doc, u);
  },
}));
vi.mock('@/lib/sync/hocuspocus-sync.js', () => ({
  getHocuspocusSync: () => ({
    joinNoteRoom: vi.fn(),
    leaveNoteRoom: vi.fn(),
  }),
  setRoomKey: vi.fn(),
}));
vi.mock('@/lib/yjs/shared.js', () => ({
  registerActiveDoc: vi.fn(),
  unregisterActiveDoc: vi.fn(),
}));
vi.mock('@/composable/useNoteSharing', () => ({
  useNoteSharing: () => ({ ensureNoteKey: vi.fn(async () => 'k') }),
}));
vi.mock('@/store/workspace', () => ({ useWorkspaceStore: () => ({ activeId: 'ws1' }) }));

import { flushPromises } from '@vue/test-utils';
import * as Y from 'yjs';
import { openRowDoc, useDatabaseYjs, rowDocId, persistRowDocSnapshot } from '@/composable/useDatabaseYjs.js';
import { appendUpdate, getUpdates, getSnapshot, compactUpdates } from '@/lib/native/yjs.js';

describe('useDatabaseYjs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    getUpdates.mockReturnValue([]);
    getSnapshot.mockReturnValue(null);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('rowDocId uses db: prefix so FTS/backups ignore it', () => {
    expect(rowDocId('abc')).toBe('db:abc');
  });

  it('create/update/delete mutate the shared rows array and bump version', async () => {
    const api = useDatabaseYjs('db1');
    await flushPromises();
    expect(api.ready.value).toBe(true);
    const id = api.createRow({ c1: 'hello' });
    expect(api.version.value).toBeGreaterThan(0);
    api.updateCells(id, { c1: 'world' });
    expect(api.getRow(id).cells.c1).toBe('world');
    api.deleteRow(id);
    expect(api.getRow(id)).toBe(null);
  });

  it('debounced flush persists merged updates under prefixed id; snapshot compacts under same id', async () => {
    const api = useDatabaseYjs('db2');
    await flushPromises();
    api.createRow({});
    await vi.advanceTimersByTimeAsync(400); // FLUSH_DELAY_MS = 300
    expect(appendUpdate.mock.calls[0][0]).toBe('db:db2');
    expect(appendUpdate.mock.calls[0][1]).toBeInstanceOf(Uint8Array);
    const { doc } = await openRowDoc('db2');
    await persistRowDocSnapshot('db2', doc);
    expect(compactUpdates).toHaveBeenCalledWith('db:db2', expect.anything());
  });

  it('replays persisted updates on load', async () => {
    const doc = new Y.Doc();
    doc.getArray('rows').push([new Y.Map(Object.entries({ id: 'r9' }))]);
    getUpdates.mockReturnValue([Y.encodeStateAsUpdate(doc)]);
    getSnapshot.mockReturnValue(null);
    const { rows } = await openRowDoc('db3');
    expect(rows.length).toBe(1);
  });
});
