import { invokeCommand } from '@/lib/tauri/commands';

/**
 * Full-text search backed by the SQLite FTS5 index.
 *
 * @param {string} query  - Raw search string from the user.
 * @param {number} [limit=200] - Max number of IDs to return.
 * @returns {Promise<string[]>} Note IDs ordered by relevance.
 */
export function searchNotesFts(query, limit = 200) {
  return invokeCommand('search:notes', { query, limit });
}

/**
 * Upsert a note into the FTS index.
 * Call this every time a note's title or content changes.
 *
 * @param {string} id    - Note ID.
 * @param {string} title - Note title (plain text).
 * @param {string} body  - Pre-extracted plain text from the note content.
 */
export function indexNote(id, title, body) {
  return invokeCommand('search:indexNote', { id, title, body });
}

/**
 * Remove a note from the FTS index.
 * Call this when a note is deleted.
 *
 * @param {string} id - Note ID.
 */
export function removeNoteFromIndex(id) {
  return invokeCommand('search:removeNote', { id });
}

/**
 * Rebuild the entire FTS index from the KV store.
 * Useful after a bulk import or to repair a stale index.
 *
 * @returns {Promise<number>} Number of notes indexed.
 */
export function rebuildSearchIndex() {
  return invokeCommand('search:rebuildIndex', {});
}
