import { searchNotesIndex } from '@/utils/note/search.js';

/**
 * Compute the set of note ids matching a query.
 *
 * - Empty query → `null` (match everything; caller skips filtering).
 * - `#label` queries → linear scan over labels (not MiniSearch index fields).
 * - Text queries → in-memory MiniSearch index; returns `null` if unavailable
 *   so the caller falls back to a linear scan.
 */
export function matchNoteIdsByQuery(notes, query, indexSearch = searchNotesIndex) {
  const queryLower = String(query || '').trim().toLocaleLowerCase();
  if (queryLower === '') return null;

  if (queryLower.startsWith('#')) {
    const labelQuery = queryLower.slice(1);
    const ids = new Set();
    for (const note of notes) {
      if (Array.isArray(note.labels) && note.labels.some((l) =>
        String(l).toLocaleLowerCase().includes(labelQuery)
      )) {
        ids.add(note.id);
      }
    }
    return ids;
  }

  try {
    const ids = indexSearch(queryLower);
    if (!Array.isArray(ids)) return null;
    return new Set(ids);
  } catch {
    return null;
  }
}
