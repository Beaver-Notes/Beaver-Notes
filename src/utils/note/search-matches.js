import { searchNotesIndex } from '@/utils/note/search.js';

/**
 * Compute the set of note ids that match a search query.
 *
 * - Empty query → `null` (match everything; the caller skips filtering).
 * - `#label` queries → linear scan over note labels (labels are not in the
 *   MiniSearch index fields).
 * - Text queries → union of:
 *     1. MiniSearch results (prefix + fuzzy matching, ranked), and
 *     2. a substring scan over title / searchText / labels.
 *   The scan exists because MiniSearch only matches word prefixes — a query
 *   like "ость" would never match "полость" through the index alone.
 *
 * @param {Array<{id:string, title?:string, searchText?:string, labels?:string[], isLocked?:boolean}>} notes
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

  const ids = new Set();

  try {
    const indexed = indexSearch(queryLower);
    if (Array.isArray(indexed)) {
      for (const id of indexed) ids.add(id);
    }
  } catch {
    // Index unavailable — the substring scan below still covers the query.
  }

  // Substring (infix) pass over the flat text fields.
  for (const note of notes) {
    if (!note?.id || note.isLocked) continue;

    const title = String(note.title || '').toLocaleLowerCase();
    if (title.includes(queryLower)) {
      ids.add(note.id);
      continue;
    }

    const text = String(note.searchText || '').toLocaleLowerCase();
    if (text.includes(queryLower)) {
      ids.add(note.id);
      continue;
    }

    if (
      Array.isArray(note.labels) &&
      note.labels.some((l) => String(l).toLocaleLowerCase().includes(queryLower))
    ) {
      ids.add(note.id);
    }
  }

  return ids;
}
