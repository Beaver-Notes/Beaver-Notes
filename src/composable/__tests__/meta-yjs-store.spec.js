import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';

const { folderStoreMock, labelStoreMock, noteStoreMock, docHolder, storageGet } = vi.hoisted(() => {
  const folderStoreMock = { data: {}, deletedIds: {}, _rebuildIndex: vi.fn() };
  const labelStoreMock = { data: [], colors: {} };
  const noteStoreMock = { data: {}, deletedIds: {} };
  const docHolder = { doc: null };
  const storageGet = vi.fn((key) =>
    Promise.resolve(key === 'labels' ? [] : {})
  );
  return { folderStoreMock, labelStoreMock, noteStoreMock, docHolder, storageGet };
});

vi.mock('@/composable/storage', () => ({
  useStorage: () => ({ get: storageGet }),
}));
vi.mock('@/lib/native/yjs.js', () => ({
  getSnapshots: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/store/folder', () => ({ useFolderStore: () => folderStoreMock }));
vi.mock('@/store/label', () => ({ useLabelStore: () => labelStoreMock }));
vi.mock('@/store/note', () => ({ useNoteStore: () => noteStoreMock }));
vi.mock('@/store/note/index', () => ({ saveNote: vi.fn() }));
vi.mock('../meta-yjs-doc.js', () => ({ getWorkspaceDoc: () => docHolder.doc }));

import { writeStoresFromWorkspace } from '../meta-yjs-store.js';

function seedDoc() {
  const doc = new Y.Doc();
  const folder = new Y.Map();
  folder.set('name', 'Work');
  folder.set('parentId', null);
  doc.getMap('folders').set('folder-1', folder);

  doc.getArray('labels').push(['alpha', 'beta']);
  doc.getMap('labelColors').set('alpha', '#112233');

  const note = new Y.Map();
  note.set('id', 'note-1');
  note.set('title', 'Seeded note');
  note.set('folderId', 'folder-1');
  note.set('updatedAt', 1000);
  doc.getMap('notes').set('note-1', note);

  docHolder.doc = doc;
}

function seedNoteStore(id) {
  noteStoreMock.data[id] = {
    id,
    content: { type: 'doc', content: [] },
    cardPreview: { blocks: [], hasMore: false, mediaCount: 0, visibleMediaCount: 0 },
  };
}

beforeEach(() => {
  folderStoreMock.data = {};
  folderStoreMock.deletedIds = {};
  folderStoreMock._rebuildIndex.mockClear();
  labelStoreMock.data = [];
  labelStoreMock.colors = {};
  noteStoreMock.data = {};
  noteStoreMock.deletedIds = {};
  storageGet.mockClear();
});

describe('writeStoresFromWorkspace incremental folder/label rebuilds', () => {
  it('initial hydration (no flags) rebuilds folders and labels', async () => {
    seedDoc();
    await writeStoresFromWorkspace();

    expect(folderStoreMock.data['folder-1']).toBeDefined();
    expect(folderStoreMock.data['folder-1'].name).toBe('Work');
    expect(folderStoreMock._rebuildIndex).toHaveBeenCalled();
    expect(labelStoreMock.data).toEqual(['alpha', 'beta']);
    expect(labelStoreMock.colors).toEqual({ alpha: '#112233' });
    expect(noteStoreMock.data['note-1']).toBeDefined();
  });

  it('a note-only change does not touch folders or labels', async () => {
    seedDoc();
    await writeStoresFromWorkspace();
    seedNoteStore('note-1');

    const folderDataRef = folderStoreMock.data;
    const labelDataRef = labelStoreMock.data;
    folderStoreMock._rebuildIndex.mockClear();

    const changedNote = new Y.Map();
    changedNote.set('id', 'note-1');
    changedNote.set('title', 'Renamed title');
    changedNote.set('folderId', 'folder-1');
    docHolder.doc.getMap('notes').set('note-1', changedNote);

    await writeStoresFromWorkspace(new Set(['note-1']), {
      folders: false,
      labels: false,
      labelColors: false,
      deleted: false,
    });

    expect(folderStoreMock.data).toBe(folderDataRef);
    expect(labelStoreMock.data).toBe(labelDataRef);
    expect(folderStoreMock._rebuildIndex).not.toHaveBeenCalled();
    expect(noteStoreMock.data['note-1'].title).toBe('Renamed title');
  });

  it('a folder change rebuilds folders only', async () => {
    seedDoc();
    await writeStoresFromWorkspace();
    seedNoteStore('note-1');

    const labelDataRef = labelStoreMock.data;

    docHolder.doc.getMap('folders').get('folder-1').set('name', 'Renamed folder');

    await writeStoresFromWorkspace(new Set(), {
      folders: true,
      labels: false,
      labelColors: false,
      deleted: false,
    });

    expect(folderStoreMock.data['folder-1'].name).toBe('Renamed folder');
    expect(folderStoreMock._rebuildIndex).toHaveBeenCalled();
    expect(labelStoreMock.data).toBe(labelDataRef);
  });

  it('a label change rebuilds labels only', async () => {
    seedDoc();
    await writeStoresFromWorkspace();
    seedNoteStore('note-1');

    const folderDataRef = folderStoreMock.data;

    docHolder.doc.getArray('labels').push(['gamma']);

    await writeStoresFromWorkspace(new Set(), {
      folders: false,
      labels: true,
      labelColors: false,
      deleted: false,
    });

    expect(labelStoreMock.data).toEqual(['alpha', 'beta', 'gamma']);
    expect(folderStoreMock.data).toBe(folderDataRef);
  });
});
