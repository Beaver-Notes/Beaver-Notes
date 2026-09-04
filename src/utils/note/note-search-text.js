import { extractTextFromContent } from './serializer.js';

/** Flat text for substring search. Prefers precomputed searchText, walks content only as fallback. */
export function noteSearchText(note) {
  if (note?.searchText) return note.searchText;
  return extractTextFromContent(note?.content) || '';
}
