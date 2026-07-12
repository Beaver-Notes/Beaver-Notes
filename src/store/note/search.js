import { searchNotesFts } from '@/lib/native/search';
import { useFolderStore } from '../folder';

// ─── Simple getters (kept together for discoverability) ──────────────────────

export function notes(state) {
  return Object.values(state.data).filter(({ id }) => id);
}

export function getById(state) {
  return (id) => state.data[id];
}

export function getByFolder(state) {
  return (folderId = null) =>
    Object.values(state.data).filter(
      (note) => note.folderId === folderId && note.id
    );
}

export function getNotesCountByFolder(state) {
  return (folderId = null) => {
    let count = 0;
    for (const note of Object.values(state.data)) {
      if (note.id && note.folderId === folderId) count++;
    }
    return count;
  };
}

// ─── Search-related getters ──────────────────────────────────────────────────

export function getFolderContents(state) {
  return (folderId = null) => {
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
 * field. Used when the FTS index hasn't been populated yet or for
 * callers that need a synchronous result.
 * For the primary search UI use `searchNotesSql` instead.
 */
export function searchNotes(state) {
  return (query) => {
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

export function getNotesWithPath(state) {
  return (notes = null) => {
    const notesToProcess =
      notes || Object.values(state.data).filter(({ id }) => id);
    return notesToProcess.map((note) => ({
      ...note,
      folderPath: note.folderId ? useFolderStore().getPath(note.folderId) : [],
    }));
  };
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export async function searchNotesSql(query) {
  if (!query?.trim()) return [];
  try {
    const { ids } = await searchNotesFts(query);
    return ids.map((id) => this.data[id]).filter(Boolean);
  } catch {
    // FTS not yet available (first launch before rebuild) — fall back
    return this.searchNotes(query);
  }
}
