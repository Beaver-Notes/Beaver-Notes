import { nanoid } from 'nanoid';
import { path } from '@/lib/tauri-bridge';
import { getAppDirectory } from '@/lib/native/app';
import { readDir, removePath } from '@/lib/native/fs';
import { trackDeletedAssets } from '@/utils/sync';
import { deleteUpdates } from '@/lib/native/yjs.js';
import { hydrateNote } from '@/utils/note/serializer.js';
import { buildNotePreview } from '@/utils/note/cardPreview.js';
import { isEncryptedContent } from '@/utils/crypto/encryption.js';
import { useFolderStore } from '../folder';
import { useUndoStore } from '../undo';
import {
  indexNote,
  removeNoteFromIndex,
} from '@/lib/native/search';
import {
  indexNoteForSpotlight,
  deleteNoteFromSpotlight,
  reindexAllNotes,
} from '@/utils/platform/spotlightSync.js';
import { collectExpiredIds } from '@/utils/helpers/index.js';
import {
  rebuildLinkIndexForNote,
  removeNoteFromLinkIndex,
  rebuildLinkIndexFromAll,
} from './backlinks';
import {
  syncNoteMeta,
  removeNoteMeta,
  syncDeletedNoteIds,
} from '@/composable/useWorkspaceYjs';

export interface NoteData {
  id: string;
  title: string;
  content: any;
  labels: string[];
  createdAt: number;
  updatedAt: number;
  isBookmarked: boolean;
  isArchived: boolean;
  isLocked: boolean;
  isFullWidth: boolean;
  folderId: string | null;
  preview?: string;
  searchText?: string;
  cardPreview?: any;
}

export interface NoteState {
  data: Record<string, NoteData>;
  deletedIds: Record<string, number>;
  lockStatus: Record<string, unknown>;
  isLocked: Record<string, unknown>;
  syncInProgress: boolean;
}

const _skipUndo = { value: false };

// ── search (from search.js) ──

// ─── Simple getters (kept together for discoverability) ──────────────────────

export function notes(state: NoteState) {
  return Object.values(state.data).filter(({ id }) => id);
}

export function getById(state: NoteState) {
  return (id: string) => state.data[id];
}

export function getByFolder(state: NoteState) {
  return (folderId: string | null = null) =>
    Object.values(state.data).filter(
      (note) => note.folderId === folderId && note.id
    );
}

export function getNotesCountByFolder(state: NoteState) {
  return (folderId: string | null = null) => {
    let count = 0;
    for (const note of Object.values(state.data)) {
      if (note.id && note.folderId === folderId) count++;
    }
    return count;
  };
}

// ─── Search-related getters ──────────────────────────────────────────────────

export function getFolderContents(state: NoteState) {
  return (folderId: string | null = null) => {
    const notes = Object.values(state.data)
      .filter((note) => note.folderId === folderId && note.id)
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const folders = useFolderStore()
      .getByParent(folderId)
      .sort((a: any, b: any) => a.name.localeCompare(b.name));

    return { folders, notes };
  };
}

/**
 * Synchronous in-memory fallback search using the pre-computed `searchText`
 * field. Used when the FTS index hasn't been populated yet or for
 * callers that need a synchronous result.
 * For the primary search UI use `searchNotesSql` instead.
 */
export function searchNotes(state: NoteState) {
  return (query: string) => {
    const searchTerm = query.toLowerCase();
    return Object.values(state.data).filter((note) => {
      if (!note.id) return false;
      return (
        note.title.toLowerCase().includes(searchTerm) ||
        (note.searchText || '').toLowerCase().includes(searchTerm)
      );
    });
  };
}

export function getNotesWithPath(state: NoteState) {
  return (notes: NoteData[] | null = null) => {
    const notesToProcess: NoteData[] =
      notes || Object.values(state.data).filter(({ id }) => id);
    return notesToProcess.map((note) => ({
      ...note,
      folderPath: note.folderId ? (useFolderStore() as any).getPath(note.folderId) : [],
    }));
  };
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export interface NoteStoreThis {
  data: Record<string, NoteData>;
  deletedIds: Record<string, number>;
  searchNotes?(query: string): NoteData[];
  patchLocal(id: string, data?: Record<string, any>): NoteData | null;
  persist(id: string): Promise<NoteData | null>;
  delete(id: string): Promise<string>;
  cleanupDeletedIds(days?: number): Promise<string[]>;
}

export async function searchNotesSql(this: NoteStoreThis, query: string): Promise<NoteData[]> {
  if (!query?.trim()) return [];
  try {
    const { ids } = (await import('@/lib/native/search')).searchNotesFts(query) as any;
    return ids.map((id: string) => this.data[id]).filter(Boolean);
  } catch {
    // FTS not yet available (first launch before rebuild) — fall back
    return this.searchNotes!(query);
  }
}

// ── crud (from crud.js) ──

// ─── Load & hydration ────────────────────────────────────────────────────────

export async function retrieve(this: NoteStoreThis): Promise<Record<string, NoteData>> {
  try {
    // Data is already populated from the Yjs workspace doc via
    // writeStoresFromWorkspace().  No KV reads needed.

    reindexAllNotes(this.data);
    rebuildLinkIndexFromAll(this.data);

    return this.data;
  } catch (error) {
    console.error('Error retrieving notes:', error);
    throw error;
  }
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function add(this: NoteStoreThis, note: Partial<NoteData> & Record<string, any> = {}): Promise<NoteData> {
  try {
    const folderId = await resolveFolderId(note.folderId);
    const id = note.id || nanoid();
    const newNote = {
      id,
      title: '',
      content: { type: 'doc', content: [] },
      labels: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isBookmarked: false,
      isArchived: false,
      isLocked: false,
      isFullWidth: false,
      ...note,
      folderId,
    } as NoteData;

    this.data[id] = hydrateNote(newNote);
    await saveNote(id, this.data[id]);
    rebuildLinkIndexForNote(id, this.data[id].content);
    syncNoteMeta(this.data[id]);

    return this.data[id];
  } catch (error) {
    console.error('Error adding note:', error);
    throw error;
  }
}

export async function update(this: NoteStoreThis, id: string, data: Record<string, any> = {}): Promise<NoteData> {
  try {
    if (data.folderId !== undefined && data.folderId !== null) {
      const folderStore = useFolderStore();
      if (!(await folderStore.exists(data.folderId))) {
        throw new Error('Specified folder does not exist');
      }
    }

    const prevBm = this.data[id]?.isBookmarked;
    const prevArch = this.data[id]?.isArchived;

    this.patchLocal(id, data);
    await this.persist(id);
    syncNoteMeta(this.data[id]);

    if (
      prevBm !== undefined &&
      data.isBookmarked !== undefined &&
      prevBm !== data.isBookmarked
    ) {
      useUndoStore().push({
        type: 'toggle-bookmark',
        notes: [{ id, prev: prevBm }],
      });
    }

    if (
      prevArch !== undefined &&
      data.isArchived !== undefined &&
      prevArch !== data.isArchived
    ) {
      useUndoStore().push({
        type: 'toggle-archive',
        notes: [{ id, prev: prevArch }],
        folders: [],
      });
    }

    return this.data[id];
  } catch (error) {
    console.error('Error updating note:', error);
    throw error;
  }
}

export function patchLocal(this: NoteStoreThis, id: string, data: Record<string, any> = {}): NoteData | null {
  if (!this.data[id]) return null;

  this.data[id] = hydrateNote({
    ...this.data[id],
    ...data,
    updatedAt: data.updatedAt ?? Date.now(),
  });

  return this.data[id];
}

export async function persist(this: NoteStoreThis, id: string): Promise<NoteData | null> {
  if (!this.data[id]) return null;

  const note = this.data[id];
  // Rebuild the structured card preview from content (styled blocks) so it
  // survives a reload, and keep a flat `preview` string as a cross-device
  // fallback. Content lives in the per-note Y.Doc; `searchText` is stripped
  // before persist so it is no longer the source of truth.
  if (!note.isLocked && !isEncryptedContent(note.content)) {
    const { cardPreview, preview } = buildNotePreview({
      content: note.content,
      preview: note.preview,
      searchText: note.searchText,
    });
    note.preview = preview;
    note.cardPreview = cardPreview;
  }

  await saveNote(id, note);
  rebuildLinkIndexForNote(id, note.content);
  syncNoteMeta(note);

  return note;
}

export async function deleteNote(this: NoteStoreThis, id: string): Promise<string> {
  try {
    const snapshot =
      !_skipUndo.value && this.data[id]
        ? JSON.parse(JSON.stringify(this.data[id]))
        : null;

    const lastEditedNote = localStorage.getItem('lastNoteEdit');
    if (lastEditedNote === id) localStorage.removeItem('lastNoteEdit');

    this.deletedIds = this.deletedIds || {};
    if (!this.deletedIds[id]) {
      this.deletedIds[id] = Date.now();
    }

    delete this.data[id];
    removeNoteFromLinkIndex(id);

    // Clean up Yjs document updates
    deleteUpdates(id).catch(() => {});

    removeNoteFromFts(id);

    removeNoteMeta(id);
    syncDeletedNoteIds(this.deletedIds);

    this.cleanupDeletedIds(30);

    // Best-effort cleanup of asset files on disk
    try {
      const appDirectory = await getAppDirectory();
      if (appDirectory) {
        for (const assetType of ['notes-assets', 'file-assets']) {
          const assetDir = path.join(appDirectory, assetType, id);
          try {
            const files = await readDir(assetDir);
            if (files?.length) await trackDeletedAssets(assetType, id, files);
          } catch {
            // Asset folder may not exist — that's fine
          }
          await removePath(path.join(appDirectory, assetType, id));
        }
      }
    } catch (fileError) {
      console.warn('Error removing note files:', fileError);
    }

    if (snapshot) {
      useUndoStore().push({
        type: 'bulk-delete',
        items: [{ type: 'note', data: snapshot }],
      });
    }

    return id;
  } catch (error) {
    console.error('Error deleting note:', error);
    throw error;
  }
}

export async function cleanupDeletedIds(this: NoteStoreThis, days = 30): Promise<string[]> {
  const toDelete = collectExpiredIds(this.deletedIds, days);

  for (const id of toDelete) {
    delete this.deletedIds[id];
  }

  syncDeletedNoteIds(this.deletedIds);

  return toDelete;
}

// ─── Folder operations ───────────────────────────────────────────────────────

export async function moveToFolder(this: NoteStoreThis, noteIds: string[], folderId: string | null): Promise<NoteData[]> {
  try {
    const targetFolderId = folderId ?? null;
    if (targetFolderId !== null) {
      const folderStore = useFolderStore();
      if (!(await folderStore.exists(targetFolderId))) {
        throw new Error('Target folder does not exist');
      }
    }

    const undoNotes: { id: string; prevFolderId: string | null | undefined }[] = [];
    const updatePromises: Promise<any>[] = [];
    for (const noteId of noteIds) {
      if (this.data[noteId]) {
        undoNotes.push({
          id: noteId,
          prevFolderId: this.data[noteId].folderId,
        });
        this.patchLocal(noteId, { folderId: targetFolderId });
        updatePromises.push(
          this.persist(noteId).then(() => syncNoteMeta(this.data[noteId]))
        );
      }
    }

    await Promise.all(updatePromises);

    useUndoStore().push({ type: 'move', notes: undoNotes, folders: [] });
    return undoNotes.map((n) => this.data[n.id]);
  } catch (error) {
    console.error('Error moving multiple notes to folder:', error);
    throw error;
  }
}

export async function handleFolderDeletion(this: NoteStoreThis, deletionResult: any): Promise<{ noteIds: string[]; noteSnapshots: { type: string; data: any }[] }> {
  try {
    const { deletedFolderId, descendantIds, moveContentsTo, deleteContents } =
      deletionResult;

    const affectedFolderIds = new Set([deletedFolderId, ...descendantIds]);
    const affectedNotes = Object.values(this.data).filter((note) =>
      affectedFolderIds.has(note.folderId)
    );

    _skipUndo.value = true;
    if (deleteContents) {
      for (const note of affectedNotes) {
        await this.delete(note.id);
      }
    } else {
      const updatePromises = affectedNotes.map((note) => {
        this.patchLocal(note.id, { folderId: moveContentsTo });
        return this.persist(note.id).then(() => syncNoteMeta(this.data[note.id]));
      });
      await Promise.all(updatePromises);
    }
    _skipUndo.value = false;

    const snapshots = deleteContents
      ? affectedNotes.map((note) => ({
          type: 'note',
          data: JSON.parse(JSON.stringify(note)),
        }))
      : [];

    return {
      noteIds: affectedNotes.map((note) => note.id),
      noteSnapshots: snapshots,
    };
  } catch (error) {
    console.error('Error handling folder deletion:', error);
    throw error;
  }
}

export async function normalizeInvalidFolderIds(this: NoteStoreThis): Promise<string[]> {
  const folderStore = useFolderStore();
  const invalid = Object.values(this.data).filter(
    (note) => note?.id && note.folderId && !folderStore.exists(note.folderId)
  );

  for (const note of invalid) {
    this.patchLocal(note.id, { folderId: null });
    await this.persist(note.id);
  }

  return invalid.map((note) => note.id);
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export async function addLabel(this: NoteStoreThis, id: string, labelId: string): Promise<string | undefined> {
  try {
    if (!this.data[id]) {
      console.error('Note not found');
      return;
    }

    if (this.data[id].labels.includes(labelId)) return labelId;

    this.data[id] = hydrateNote({
      ...this.data[id],
      labels: [...this.data[id].labels, labelId],
      updatedAt: Date.now(),
    });

    await saveNote(id, this.data[id]);
    syncNoteMeta(this.data[id]);

    return labelId;
  } catch (error) {
    console.error('Error adding label:', error);
    throw error;
  }
}

export async function removeLabel(this: NoteStoreThis, id: string, labelId: string): Promise<string | undefined> {
  try {
    if (!this.data[id]) {
      console.error('Note not found');
      return;
    }

    const idx = this.data[id].labels.indexOf(labelId);
    if (idx === -1) return;

    const labels = [...this.data[id].labels];
    labels.splice(idx, 1);
    this.data[id] = hydrateNote({
      ...this.data[id],
      labels,
      updatedAt: Date.now(),
    });

    await saveNote(id, this.data[id]);
    syncNoteMeta(this.data[id]);

    return labelId;
  } catch (error) {
    console.error('Error removing label:', error);
    throw error;
  }
}

// ── helpers (from helpers.js) ──

/**
 * Silently sync a note into the FTS index after it is written to storage.
 * Uses the pre-computed `searchText` field so no content serialisation is needed.
 * Errors are swallowed — a stale index degrades gracefully to no results.
 */
export function syncFtsIndex(note: NoteData): void {
  if (!note?.id || note.isLocked || isEncryptedContent(note.content)) return;
  indexNote(note.id, note.title || '', note.searchText || '').catch(() => {});
}

export async function saveNote(id: string, noteData: NoteData): Promise<void> {
  syncFtsIndex(noteData);
  indexNoteForSpotlight(noteData);
}

async function resolveFolderId(folderId: string | null | undefined): Promise<string | null> {
  if (folderId === undefined || folderId === null) return null;
  return useFolderStore().exists(folderId) ? folderId : null;
}

function removeNoteFromFts(id: string): void {
  removeNoteFromIndex(id).catch(() => {});
  deleteNoteFromSpotlight(id);
}
