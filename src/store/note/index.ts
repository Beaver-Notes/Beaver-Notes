import { ref } from 'vue';
import { nanoid } from 'nanoid';
import { path } from '@/lib/tauri-bridge';
import { getAppDirectory } from '@/lib/native/app';
import { readDir, removePath } from '@/lib/native/fs';
import { trackDeletedAssets } from '@/utils/sync';
import { deleteUpdates } from '@/lib/native/yjs.js';
import { hydrateNote, extractTextFromContent } from '@/utils/note/serializer.js';
import { buildNotePreview } from '@/utils/note/cardPreview.js';
import { isEncryptedContent, ensureKeyReadyForWrite } from '@/utils/crypto/encryption.js';
import { useFolderStore } from '../folder';
import { useUndoStore } from '../undo';
import { commands } from '@/lib/tauri/bindings';
import {
  deleteNoteFromSpotlight,
  indexNoteForSpotlight,
  reindexAllNotes,
} from '@/utils/platform/spotlightSync.js';
import {
  buildSearchIndex,
  removeSearchEntry,
  searchNotesIndex,
  upsertSearchEntry,
  getSearchIndexJSON,
  loadSearchIndex,
} from '@/utils/note/search.js';
import { collectExpiredIds } from '@/utils/helpers/index.js';
import {
  rebuildLinkIndexForNote,
  removeNoteFromLinkIndex,
  rebuildLinkIndexFromAll,
  getLinkIndexJSON,
  loadLinkIndex,
} from './backlinks';
import {
  syncNoteMeta,
  removeNoteMeta,
  syncDeletedNoteIds,
  transactWorkspace,
} from '@/lib/yjs/workspace-doc';

export interface CardPreviewBlock {
  kind: string;
  text?: string;
  src?: string;
  alt?: string;
  rows?: { text: string; isHeader: boolean }[][];
  label?: string;
  tone?: string;
  checked?: boolean;
}

export interface CardPreview {
  version: number;
  blocks: CardPreviewBlock[];
  hasMore: boolean;
  mediaCount: number;
  visibleMediaCount: number;
}

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
  showWordCount?: boolean;
  wordCountLimit?: number | null;
  folderId: string | null;
  preview?: string;
  searchText?: string;
  cardPreview?: CardPreview;
}

export interface NoteState {
  data: Record<string, NoteData>;
  deletedIds: Record<string, number>;
  lockStatus: Record<string, unknown>;
  isLocked: Record<string, unknown>;
  syncInProgress: boolean;
}

const _skipUndo = { value: false };

export function setSkipUndo(value: boolean): void {
  _skipUndo.value = value;
}

const contentSignature: Map<string, object> = new Map();
const indexSignature: Map<string, string> = new Map();

// ── Incremental folder counts ──
// Maintained by add/delete/patchLocal to avoid O(n) rebuild on every getter access.
// `folderCountsVersion` is the reactive dep so the `notesCountByFolder` getter
// (Pinia caches getters) invalidates when a count changes — otherwise it would
// return the first Map forever and folder cards would show 0 items.
const folderCounts: Map<string | null, number> = new Map();
const folderCountsVersion = ref(0);

function bumpFolderCounts() {
  folderCountsVersion.value++;
}

function incrementFolderCount(folderId: string | null) {
  const key = folderId ?? null;
  folderCounts.set(key, (folderCounts.get(key) || 0) + 1);
  bumpFolderCounts();
}

function decrementFolderCount(folderId: string | null) {
  const key = folderId ?? null;
  const count = folderCounts.get(key) || 0;
  if (count <= 1) {
    folderCounts.delete(key);
  } else {
    folderCounts.set(key, count - 1);
  }
  bumpFolderCounts();
}

function initFolderCounts(data: Record<string, NoteData>) {
  folderCounts.clear();
  for (const note of Object.values(data)) {
    if (!note?.id) continue;
    incrementFolderCount(note.folderId);
  }
  bumpFolderCounts();
}

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

/**
 * Precomputed note counts per folder, maintained incrementally by add/delete/patchLocal.
 * Avoids O(n) rebuild on every store mutation.
 */
export function notesCountByFolder(_state: NoteState): Map<string | null, number> {
  // Reading the reactive version counter makes this getter re-evaluate whenever
  // a count changes, so it returns a fresh Map (never a stale cached one).
  void folderCountsVersion.value;
  return new Map(folderCounts);
}

// ─── Search-related getters ──────────────────────────────────────────────────

export function getFolderContents(state: NoteState) {
  return (folderId: string | null = null) => {
    const notes = Object.values(state.data)
      .filter((note) => note.folderId === folderId && note.id)
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const folders = useFolderStore()
      .getByParent(folderId)
      .sort((a, b) => a.name.localeCompare(b.name));

    return { folders, notes };
  };
}

/**
 * Synchronous in-memory fallback search using the pre-computed `searchText`
 * field. Used when the local search index hasn't been populated yet or for
 * callers that need a synchronous result.
 * For the primary search UI use `searchNotesSql` instead.
 */
export function searchNotes(state: NoteState) {
  return (query: string) => {
    const searchTerm = query.toLowerCase();
    return Object.values(state.data).filter((note) => {
      if (!note.id) return false;
      const labels = Array.isArray(note.labels) ? note.labels.join(' ') : '';
      return (
        note.title.toLowerCase().includes(searchTerm) ||
        (note.searchText || '').toLowerCase().includes(searchTerm) ||
        labels.toLowerCase().includes(searchTerm)
      );
    });
  };
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export interface NoteStoreThis {
  data: Record<string, NoteData>;
  deletedIds: Record<string, number>;
  searchNotes?(query: string): NoteData[];
  patchLocal(id: string, data?: Record<string, any>): NoteData | null;
  persist(id: string): Promise<NoteData | null>;
  persistMeta(id: string): Promise<NoteData | null>;
  delete(id: string): Promise<string>;
  cleanupDeletedIds(days?: number): Promise<string[]>;
  addMany?(notes: NoteData[]): Promise<void>;
}

export async function searchNotesSql(this: NoteStoreThis, query: string): Promise<NoteData[]> {
  if (!query?.trim()) return [];
  try {
    const ids = searchNotesIndex(query);
    return ids.map((id: string) => this.data[id]).filter(Boolean);
  } catch {
    // Index not yet available (first launch before rebuild) — fall back
    return this.searchNotes!(query);
  }
}

// ── crud (from crud.js) ──

// ─── Load & hydration ────────────────────────────────────────────────────────

export async function retrieve(this: NoteStoreThis): Promise<Record<string, NoteData>> {
  try {
    // Data is already populated from the Yjs workspace doc via
    // writeStoresFromWorkspace().  No KV reads needed.

    initFolderCounts(this.data);

    let coldStart = false;
    let indexChanged = false;

    // Try to load and reconcile persisted indexes
    try {
      const snapshotResult = await commands.indexLoad();
      if (snapshotResult.status === 'ok' && snapshotResult.data) {
        const snapshot = snapshotResult.data;
        loadSearchIndex(snapshot.searchJson);
        loadLinkIndex(snapshot.linksJson);
        const signatures = JSON.parse(snapshot.signaturesJson || '{}');

        // Incremental patch: update only changed notes
        for (const note of Object.values(this.data)) {
          if (!note?.id) continue;
          if (!signatures[note.id] || note.updatedAt > signatures[note.id]) {
            upsertSearchEntry(note);
            rebuildLinkIndexForNote(note.id, note.content);
            signatures[note.id] = note.updatedAt;
            indexChanged = true;
          }
        }
        // Remove deleted notes from indexes
        for (const id of Object.keys(signatures)) {
          if (!this.data[id]) {
            removeSearchEntry(id);
            removeNoteFromLinkIndex(id);
            delete signatures[id];
            indexChanged = true;
          }
        }
        // Persist updated indexes only when something actually changed
        if (indexChanged) {
          await commands.indexSave(
            getSearchIndexJSON(),
            getLinkIndexJSON(),
            JSON.stringify(signatures)
          );
        }
      } else {
        coldStart = true;
      }
    } catch (indexError) {
      // Corrupt/stale persisted index — fall back to full rebuild
      console.error(
        'Persisted index invalid; falling back to full rebuild:',
        indexError
      );
      coldStart = true;
    }

    // Skip Spotlight reindex when nothing changed
    if (coldStart || indexChanged) {
      reindexAllNotes(this.data);
    }
    return this.data;
  } catch (error) {
    console.error('Error retrieving notes:', error);
    throw error;
  }
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function add(this: NoteStoreThis, note: Partial<NoteData> & Record<string, any> = {}): Promise<NoteData> {
  try {
    await ensureKeyReadyForWrite();
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
      showWordCount: false,
      wordCountLimit: null,
      ...note,
      folderId,
    } as NoteData;

    this.data[id] = hydrateNote(newNote);
    if (this.deletedIds[id]) {
      delete this.deletedIds[id];
      syncDeletedNoteIds(this.deletedIds);
    }
    incrementFolderCount(this.data[id].folderId);
    await saveNote(id, this.data[id]);
    // Content lives in Yjs — write it at creation so the editor finds it
    // immediately (no KV content, no later conversion).
    const { writeNoteContentToYjs } = await import('@/utils/note/contentToYjs.js');
    await writeNoteContentToYjs(id, this.data[id].content);
    rebuildLinkIndexForNote(id, this.data[id].content);
    syncNoteMeta(this.data[id]);

    return this.data[id];
  } catch (error) {
    console.error('Error adding note:', error);
    throw error;
  }
}

export async function addMany(this: NoteStoreThis, notes: NoteData[]): Promise<void> {
  if (!notes.length) return;

  await ensureKeyReadyForWrite();

  for (const note of notes) {
    this.data[note.id] = hydrateNote(note);
    incrementFolderCount(this.data[note.id].folderId);
  }

  transactWorkspace(() => {
    for (const note of notes) {
      syncNoteMeta(this.data[note.id]);
    }
  });

  // Imports convert content to Yjs in one batched IPC — the app never stores
  // note content outside Yjs.
  const { writeNotesContentToYjs } = await import('@/utils/note/contentToYjs.js');
  await writeNotesContentToYjs(notes);

  buildSearchIndex(this.data);
  rebuildLinkIndexFromAll(this.data);
  reindexAllNotes(this.data);

  // Persist indexes for next startup
  const signatures: Record<string, number> = {};
  for (const note of Object.values(this.data)) {
    if (note?.id) signatures[note.id] = note.updatedAt;
  }
  await commands.indexSave(
    getSearchIndexJSON(),
    getLinkIndexJSON(),
    JSON.stringify(signatures)
  );
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

  const prevFolderId = this.data[id].folderId;
  this.data[id] = hydrateNote({
    ...this.data[id],
    ...data,
    updatedAt: data.updatedAt ?? Date.now(),
  });

  if (data.folderId !== undefined && data.folderId !== prevFolderId) {
    decrementFolderCount(prevFolderId);
    incrementFolderCount(data.folderId);
  }

  return this.data[id];
}

export async function persist(this: NoteStoreThis, id: string): Promise<NoteData | null> {
  if (!this.data[id]) return null;

  await ensureKeyReadyForWrite();

  const note = this.data[id];
  const contentChanged = note.content !== contentSignature.get(id);

  // Rebuild preview + searchText only when content actually changed
  if (!note.isLocked && !isEncryptedContent(note.content)) {
    if (contentChanged) {
      const { cardPreview, preview } = buildNotePreview({
        content: note.content,
        preview: note.preview,
        searchText: note.searchText,
      });
      note.preview = preview;
      note.cardPreview = cardPreview as CardPreview;
      note.searchText = extractTextFromContent(note.content) || note.searchText;
    }
  }

  if (contentChanged) {
    await saveNote(id, note);
    rebuildLinkIndexForNote(id, note.content);
    } else {
      // Content unchanged — only reindex if title/searchText/labels changed
      const indexKey = `${note.title}\0${(note.searchText || '').length}\0${(note.labels || []).join()}`;
      if (indexKey !== indexSignature.get(id)) {
        await saveNote(id, note);
      }
    }

    syncNoteMeta(note);

    // Update signatures
    contentSignature.set(id, note.content);
    indexSignature.set(id, `${note.title}\0${(note.searchText || '').length}\0${(note.labels || []).join()}`);

  return note;
}

export async function persistMeta(this: NoteStoreThis, id: string): Promise<NoteData | null> {
  if (!this.data[id]) return null;
  await ensureKeyReadyForWrite();
  const note = this.data[id];

  // Skip content walks (preview, searchText) — content unchanged
  // Skip MiniSearch/Spotlight — only title/searchText/labels matter, and
  // meta-only ops don't change those either
  // Skip rebuildLinkIndexForNote — links live in content

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

    const folderId = this.data[id]?.folderId;
    delete this.data[id];
    if (folderId !== undefined) decrementFolderCount(folderId);
    contentSignature.delete(id);
    indexSignature.delete(id);
    removeNoteFromLinkIndex(id);

    // Clean up Yjs document updates
    deleteUpdates(id).catch((error) => {
      console.warn('[note] failed to delete Yjs updates for', id, error);
    });

    removeSearchEntry(id);

    deleteNoteFromSpotlight(id);

    removeNoteMeta(id);
    syncDeletedNoteIds(this.deletedIds);

    this.cleanupDeletedIds(30);

    // Best-effort cleanup of asset files on disk
    try {
      const appDirectory = await getAppDirectory();
      if (appDirectory) {
        const assetDir = path.join(appDirectory, 'assets', id);
        try {
          const files = await readDir(assetDir);
          if (files?.length) await trackDeletedAssets('assets', id, files);
        } catch {
          // Asset folder may not exist — that's fine
        }
        await removePath(assetDir);
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
    const updatePromises: Promise<NoteData | null>[] = [];
    for (const noteId of noteIds) {
      if (this.data[noteId]) {
        undoNotes.push({
          id: noteId,
          prevFolderId: this.data[noteId].folderId,
        });
        this.patchLocal(noteId, { folderId: targetFolderId });
        updatePromises.push(this.persistMeta(noteId));
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

export async function normalizeInvalidFolderIds(this: NoteStoreThis): Promise<string[]> {
  const folderStore = useFolderStore();
  const invalid = Object.values(this.data).filter(
    (note) => note?.id && note.folderId && !folderStore.exists(note.folderId)
  );

  for (const note of invalid) {
    this.patchLocal(note.id, { folderId: null });
    await this.persistMeta(note.id);
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

    await ensureKeyReadyForWrite();

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

    await ensureKeyReadyForWrite();

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
 * Silently sync a note into the local search index after it is written to storage.
 * Uses the pre-computed `searchText` field so no content serialisation is needed.
 * Errors are swallowed — a stale index degrades gracefully to no results.
 */
export function syncSearchIndex(note: NoteData): void {
  if (!note?.id || note.isLocked || isEncryptedContent(note.content)) return;
  upsertSearchEntry(note);
}

export async function saveNote(id: string, noteData: NoteData): Promise<void> {
  syncSearchIndex(noteData);
  indexNoteForSpotlight(noteData);
}

async function resolveFolderId(folderId: string | null | undefined): Promise<string | null> {
  if (folderId === undefined || folderId === null) return null;
  return useFolderStore().exists(folderId) ? folderId : null;
}
