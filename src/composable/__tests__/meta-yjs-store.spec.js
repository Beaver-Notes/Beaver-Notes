import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';

const { folderStoreMock, labelStoreMock, noteStoreMock, docHolder } = vi.hoisted(() => {
  const folderStoreMock = { data: {}, deletedIds: {}, _rebuildIndex: vi.fn() };
  const labelStoreMock = { data: [], colors: {} };
  const noteStoreMock = { data: {}, deletedIds: {} };
  const docHolder = { doc: null };
  return { folderStoreMock, labelStoreMock, noteStoreMock, docHolder };
});

vi.mock('@/lib/native/yjs.js', () => ({
  getSnapshots: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/store/folder', () => ({ useFolderStore: () => folderStoreMock }));
vi.mock('@/store/label', () => ({ useLabelStore: () => labelStoreMock }));
vi.mock('@/store/note', () => ({ useNoteStore: () => noteStoreMock }));
vi.mock('@/store/note/index', () => ({ saveNote: vi.fn() }));
vi.mock('@/lib/yjs/meta-doc.js', () => ({ getWorkspaceDoc: () => docHolder.doc, onWorkspaceDocDestroy: vi.fn() }));

import { writeStoresFromWorkspace } from '@/lib/yjs/meta-store.js';

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

describe('seedWorkspaceDocFromData (frontend-led import)', () => {
  beforeEach(() => {
    docHolder.doc = new Y.Doc();
  });

  it('seeds note meta, folders, labels, colors, and deleted tombstones', async () => {
    const { seedWorkspaceDocFromData } = await import('@/lib/yjs/meta-store.js');
    const notes = {
      'note-1': { id: 'note-1', title: 'One', folderId: 'f1', labels: ['alpha'], createdAt: 1, updatedAt: 2 },
    };
    const folders = { f1: { id: 'f1', name: 'Folder' } };
    const labels = ['alpha'];
    const labelColors = { alpha: '#112233' };
    const deletedIds = { 'dead-1': 123 };
    const deletedFolderIds = { 'dead-f1': 456 };

    await seedWorkspaceDocFromData(notes, folders, labels, labelColors, deletedIds, deletedFolderIds);

    const doc = docHolder.doc;
    const yNote = doc.getMap('notes').get('note-1');
    expect(yNote.get('id')).toBe('note-1');
    expect(yNote.get('title')).toBe('One');
    expect(yNote.get('folderId')).toBe('f1');
    expect(yNote.has('content')).toBe(false);
    expect(doc.getMap('folders').get('f1').get('name')).toBe('Folder');
    expect(doc.getArray('labels').toArray()).toEqual(['alpha']);
    expect(doc.getMap('labelColors').get('alpha')).toBe('#112233');
    expect(doc.getMap('deletedNoteIds').get('dead-1')).toBe(123);
    expect(doc.getMap('deletedFolderIds').get('dead-f1')).toBe(456);
  });

  it('overwrites stale note entries from a prior broken seed (valid ids win)', async () => {
    // Simulate a stale workspace doc: a note key exists but carries an empty
    // id (the first broken migration seeded KV envelopes which had no readable
    // id/title). The parsed legacy data is authoritative and must win.
    const { seedWorkspaceDocFromData } = await import('@/lib/yjs/meta-store.js');
    const doc = docHolder.doc;
    const stale = new Y.Map();
    stale.set('id', '');
    doc.getMap('notes').set('note-1', stale);

    await seedWorkspaceDocFromData(
      { 'note-1': { id: 'note-1', title: 'Correct', createdAt: 1, updatedAt: 2 } },
      {},
      [],
      {},
      {},
      {}
    );

    const yNote = doc.getMap('notes').get('note-1');
    expect(yNote.get('id')).toBe('note-1');
    expect(yNote.get('title')).toBe('Correct');
  });
});
