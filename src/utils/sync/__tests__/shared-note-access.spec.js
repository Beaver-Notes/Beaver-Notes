import { describe, it, expect, vi, beforeEach } from 'vitest';

const data = {};
const patched = [];
const persisted = [];
const registered = [];

vi.mock('@/store/note', () => ({
  useNoteStore: () => ({
    data,
    patchLocal: (id, patch) => {
      patched.push([id, patch]);
      data[id] = { ...(data[id] || { id }), ...patch };
      return data[id];
    },
    persistMeta: (id) => persisted.push(id),
  }),
}));

vi.mock('@/lib/tauri-bridge', () => ({
  backend: { invoke: (...a) => registered.push(a) },
}));

const { applySharedNoteAccess, resolveNoteWorkspaceId, isSharedNote } = await import(
  '@/utils/sync/shared-notes'
);

describe('shared note access', () => {
  beforeEach(() => {
    for (const k of Object.keys(data)) delete data[k];
    patched.length = 0;
    persisted.length = 0;
    registered.length = 0;
  });

  it('stamps the owning workspace on the note, not in a side map', async () => {
    data.n1 = { id: 'n1', title: 'x', updatedAt: 5 };
    await applySharedNoteAccess([{ noteId: 'n1', workspaceId: 'w1', role: 'viewer' }]);

    expect(data.n1.access).toEqual({ role: 'viewer', workspaceId: 'w1', by: undefined });
    expect(data.n1.updatedAt).toBe(5);
    expect(resolveNoteWorkspaceId('n1', 'active')).toBe('w1');
    expect(registered).toContainEqual([
      'sync:registerSharedNoteLocation',
      { noteId: 'n1', workspaceId: 'w1' },
    ]);
  });

  it('clears the grant on a note that is no longer shared', async () => {
    data.n1 = { id: 'n1', access: { role: 'editor', workspaceId: 'w1' }, updatedAt: 5 };
    await applySharedNoteAccess([]);
    expect(data.n1.access).toBeUndefined();
    expect(resolveNoteWorkspaceId('n1', 'active')).toBe('active');
    expect(isSharedNote('n1')).toBe(false);
  });

  it('is a no-op when the list is unchanged', async () => {
    data.n1 = { id: 'n1', access: { role: 'editor', workspaceId: 'w1' } };
    await applySharedNoteAccess([{ noteId: 'n1', workspaceId: 'w1', role: 'editor' }]);
    expect(patched).toEqual([]);
    expect(registered).toEqual([]);
  });

  it('ignores a row with no owning workspace (never pushed)', async () => {
    data.n1 = { id: 'n1', updatedAt: 5 };
    await applySharedNoteAccess([{ noteId: 'n1', workspaceId: null }]);
    expect(data.n1.access).toBeUndefined();
    expect(registered).toEqual([]);
  });
});
