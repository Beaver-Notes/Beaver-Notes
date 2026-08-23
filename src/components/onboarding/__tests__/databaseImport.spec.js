import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/native/dialog', () => ({ openDialog: vi.fn() }));
vi.mock('@/lib/native/fs', () => ({
  readFile: vi.fn(),
  readDir: vi.fn(),
  isFile: vi.fn(),
}));
vi.mock('@/lib/native/yjs.js', () => ({
  appendUpdate: vi.fn(),
  getUpdates: vi.fn(() => []),
  getSnapshot: vi.fn(() => null),
  compactUpdates: vi.fn(),
  deleteUpdates: vi.fn(),
}));
vi.mock('@/utils/sync/sync-repository.js', () => ({
  getCommitsDir: vi.fn(async () => '/commits'),
  getSyncDeviceId: vi.fn(() => 'device'),
}));
vi.mock('@/utils/sync/pending-writes.js', () => ({ queueSyncWrite: vi.fn() }));
vi.mock('@/lib/yjs/helpers.js', () => ({
  getDeviceId: vi.fn(() => 'device'),
  toUint8Array: (data) =>
    data instanceof Uint8Array ? data : new Uint8Array(data ?? []),
  applyUpdatesToDoc: (doc, updates) => {
    for (const u of updates || []) Y.applyUpdate(doc, u);
  },
  yMapToObj: (m) => m?.toJSON?.() ?? {},
  objToYMap: (obj) => {
    const map = new Y.Map();
    for (const [k, v] of Object.entries(obj ?? {})) map.set(k, v);
    return map;
  },
}));
vi.mock('@/lib/sync/hocuspocus-sync.js', () => ({
  getHocuspocusSync: () => ({
    joinNoteRoom: vi.fn(),
    leaveNoteRoom: vi.fn(),
    joinMetaRoom: vi.fn(),
  }),
  setRoomKey: vi.fn(),
  buildMetaRoomName: (id) => `meta:${id}`,
}));
vi.mock('@/lib/yjs/shared.js', () => ({
  registerActiveDoc: vi.fn(),
  unregisterActiveDoc: vi.fn(),
}));
vi.mock('@/composable/useNoteSharing', () => ({
  useNoteSharing: () => ({ ensureNoteKey: vi.fn(async () => 'k') }),
}));
vi.mock('@/store/workspace', () => ({
  useWorkspaceStore: () => ({ activeId: 'ws1' }),
}));
vi.mock('@/lib/api/workspaces', () => ({
  getCachedWorkspaceKey: vi.fn(() => 'k'),
  getWorkspaceKey: vi.fn(),
}));

import * as Y from 'yjs';
import { openDialog } from '@/lib/native/dialog';
import { readFile, readDir, isFile as nativeIsFile } from '@/lib/native/fs';
import { compactUpdates, getSnapshot } from '@/lib/native/yjs.js';
import {
  buildImportPayload,
  pickDatabaseSource,
  persistDatabaseImport,
} from '../databaseImport.js';

describe('buildImportPayload', () => {
  it('wraps a parsed result into the canonical payload shape', () => {
    const parsed = { schema: { columns: ['c'] }, rows: ['r'], issues: ['i'] };
    expect(buildImportPayload('notion', 'T', parsed)).toEqual({
      source: 'notion',
      title: 'T',
      schema: { columns: ['c'] },
      rows: ['r'],
      issues: ['i'],
    });
  });
});

describe('pickDatabaseSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeIsFile.mockImplementation(async (p) => !p.endsWith('/assets'));
    readDir.mockResolvedValue([]);
    openDialog.mockResolvedValue({ canceled: true, filePaths: [] });
  });

  it('throws for unknown sources', async () => {
    await expect(pickDatabaseSource('bear')).rejects.toThrow(/bear/);
  });

  it('returns null when the dialog is cancelled', async () => {
    await expect(pickDatabaseSource('notion')).resolves.toBe(null);
    expect(readFile).not.toHaveBeenCalled();
  });

  it('notion: reads the CSV and parses it through parseNotionCsv', async () => {
    openDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/x/My Table.csv'],
    });
    readFile.mockResolvedValue('Name,Age\nAlice,30\nBob,25\n');

    const payload = await pickDatabaseSource('notion');
    expect(payload.source).toBe('notion');
    expect(payload.title).toBe('My Table');
    expect(payload.schema.columns.map((c) => c.type)).toEqual([
      'title',
      'number',
    ]);
    expect(payload.rows).toHaveLength(2);
    const [nameCol, ageCol] = payload.schema.columns;
    expect(payload.rows[0].cells[nameCol.id]).toBe('Alice');
    expect(payload.rows[0].cells[ageCol.id]).toBe(30);
  });

  it('obsidian: walks the vault folder and parses markdown files', async () => {
    openDialog.mockResolvedValue({ canceled: false, filePaths: ['/vault'] });
    readDir.mockImplementation(async (dir) =>
      dir === '/vault'
        ? ['a.md', 'notes.md', 'assets']
        : ['ignored.png'] // /vault/assets
    );
    readFile.mockImplementation(async (p) =>
      p.endsWith('a.md')
        ? '---\nstatus: yes\n---\nBody text'
        : '# Plain note'
    );

    const payload = await pickDatabaseSource('obsidian');
    expect(payload.source).toBe('obsidian');
    expect(payload.title).toBe('vault');
    expect(payload.schema.columns[0].type).toBe('title');
    expect(payload.rows).toHaveLength(2);
    const nameCol = payload.schema.columns[0];
    expect(payload.rows.map((r) => r.cells[nameCol.id]).sort()).toEqual([
      'a',
      'notes',
    ]);
  });
});

describe('persistDatabaseImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSnapshot.mockReturnValue(null);
  });

  function fakeStore() {
    return {
      createDatabase: vi.fn(() => 'db1'),
      updateSchema: vi.fn(),
    };
  }

  const payload = {
    source: 'notion',
    title: 'Imported',
    schema: {
      columns: [{ id: 'c1', type: 'title', name: 'Name' }],
      views: [{ id: 'v1', type: 'table' }],
    },
    rows: [
      { id: 'r1', cells: { c1: 'Alice' } },
      { id: 'r2', cells: { c1: 'Bob' } },
    ],
    issues: [],
  };

  it('creates the database, patches columns+views, and persists rows in one snapshot', async () => {
    let snap;
    compactUpdates.mockImplementation(async (_id, bytes) => {
      snap = bytes;
    });
    const store = fakeStore();

    const dbId = await persistDatabaseImport(payload, store);

    expect(dbId).toBe('db1');
    expect(store.createDatabase).toHaveBeenCalledWith({ title: 'Imported' });
    expect(store.updateSchema).toHaveBeenCalledTimes(1);
    expect(store.updateSchema).toHaveBeenCalledWith('db1', {
      columns: payload.schema.columns,
      views: payload.schema.views,
    });
    expect(compactUpdates).toHaveBeenCalledWith('db:db1', expect.anything());

    // Round-trip: a fresh openRowDoc replays the persisted snapshot.
    getSnapshot.mockReturnValue(snap);
    const { openRowDoc } = await import('@/composable/useDatabaseYjs.js');
    const doc = await openRowDoc('db1');
    expect(doc.rows.length).toBe(2);
    const first = doc.rows.toArray()[0];
    expect(first.get('id')).toBe('r1');
    expect(first.get('cells').get('c1')).toBe('Alice');
  });

  it('omits views from the patch when the parser produced none', async () => {
    const store = fakeStore();
    await persistDatabaseImport(
      { ...payload, schema: { columns: payload.schema.columns }, rows: [] },
      store
    );
    const patch = store.updateSchema.mock.calls[0][1];
    expect('views' in patch).toBe(false);
    // No rows → no row doc writes at all.
    expect(compactUpdates).not.toHaveBeenCalled();
  });
});
