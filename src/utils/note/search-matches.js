import { searchNotesIndex } from '@/utils/note/search.js';

/**
 * Compute the set of note ids that match a search query.
 *
 * - Empty query → `null` (match everything; the caller skips filtering).
 * - `#label` queries → linear scan over note labels (labels are not in the
 *   MiniSearch index fields).
 * - Text queries → the in-memory MiniSearch index (already built and kept
 *   fresh by the persist path). If the index is unavailable it returns `null`
 *   so the caller falls back to a linear scan.
 *
 * @param {Array<{id:string, labels?:string[]}>} notes
 * @param {string} query
 * @returns {Set<string>|null}
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
