import { extractTextFromContent } from './serializer.js';

/**
 * The flat text used for substring search over a note. Prefers the precomputed
 * `searchText` (kept fresh by the persist path) and only walks the content tree
 * as a fallback — so search never does a full content walk per keystroke.
 */
export function noteSearchText(note) {
  if (note?.searchText) return note.searchText;
  return extractTextFromContent(note?.content) || '';
}
