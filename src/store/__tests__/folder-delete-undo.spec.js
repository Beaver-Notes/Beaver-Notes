import { setActivePinia, createPinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { noteStore } = vi.hoisted(() => {
  const data = {};
  return {
    noteStore: {
      data,
      add: vi.fn(async (n) => {
        data[n.id] = n;
        return n;
      }),
      update: vi.fn(async (id, d) => {
        data[id] = { ...data[id], ...d };
        return data[id];
      }),
      delete: vi.fn(async (id) => {
        delete data[id];
      }),
    },
  };
});

vi.mock('@/store/note', () => ({
  useNoteStore: () => noteStore,
  setSkipUndo: vi.fn(),
}));

vi.mock('@/lib/yjs/workspace-doc', () => ({
  syncFolder: vi.fn(),
  removeFolder: vi.fn(),
  syncDeletedFolderIds: vi.fn(),
}));

import { useFolderStore } from '@/store/folder';
import { useUndoStore } from '@/store/undo';

describe('folder.delete undo', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    Object.keys(noteStore.data).forEach((k) => delete noteStore.data[k]);
    vi.clearAllMocks();
  });

  it('delete-contents restores the folder and every note/subfolder on undo', async () => {
    const folder = useFolderStore();
    await folder.add({ id: 'f1', parentId: null });
    await folder.add({ id: 'f2', parentId: 'f1' });
    noteStore.data['n1'] = { id: 'n1', folderId: 'f1', title: 'a' };
    noteStore.data['n2'] = { id: 'n2', folderId: 'f2', title: 'b' };

    await folder.delete('f1', { deleteContents: true });

    expect(folder.data['f1']).toBeUndefined();
    expect(folder.data['f2']).toBeUndefined();
    expect(noteStore.data['n1']).toBeUndefined();
    expect(noteStore.data['n2']).toBeUndefined();

    await useUndoStore().undo();

    expect(folder.data['f1']?.id).toBe('f1');
    expect(folder.data['f2']?.id).toBe('f2');
    expect(noteStore.data['n1']?.folderId).toBe('f1');
    expect(noteStore.data['n2']?.folderId).toBe('f2');
  });

  it('move mode returns notes and subfolders to the folder on undo', async () => {
    const folder = useFolderStore();
    await folder.add({ id: 'f1', parentId: null });
    await folder.add({ id: 'f2', parentId: 'f1' });
    await folder.add({ id: 'f3', parentId: null });
    noteStore.data['n1'] = { id: 'n1', folderId: 'f1' };
    noteStore.data['n2'] = { id: 'n2', folderId: 'f2' };

    await folder.delete('f1', { moveContentsTo: 'f3' });

    expect(folder.data['f1']).toBeUndefined();
    expect(noteStore.data['n1']?.folderId).toBe('f3');
    expect(noteStore.data['n2']?.folderId).toBe('f2');
    expect(folder.data['f2']?.parentId).toBe('f3');

    await useUndoStore().undo();

    expect(folder.data['f1']?.id).toBe('f1');
    expect(noteStore.data['n1']?.folderId).toBe('f1');
    expect(noteStore.data['n2']?.folderId).toBe('f2');
    expect(folder.data['f2']?.parentId).toBe('f1');
  });
});
