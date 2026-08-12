import MiniSearch from 'minisearch';
import { isEncryptedContent } from '@/utils/crypto/encryption.js';
import { speed } from '@/utils/speed.js';

const SEARCH_OPTIONS = {
  fields: ['title', 'searchText', 'labelsText'],
  storeFields: ['id'],
  searchOptions: {
    prefix: true,
    fuzzy: 0.2,
  },
};

let searchIndex = new MiniSearch(SEARCH_OPTIONS);

function noteToDocument(note) {
  return {
    id: note.id,
    title: note.title || '',
    searchText: note.searchText || '',
    labelsText: Array.isArray(note.labels) ? note.labels.join(' ') : '',
  };
}

function isSearchableNote(note) {
  return !!note?.id && !note.isLocked && !isEncryptedContent(note.content);
}

export function clearSearchIndex() {
  searchIndex.removeAll();
}

export function buildSearchIndex(notes = {}) {
  clearSearchIndex();
  const docs = Object.values(notes)
    .filter(isSearchableNote)
    .map(noteToDocument);
  if (docs.length > 0) {
    searchIndex.addAll(docs);
  }
}

export function upsertSearchEntry(note) {
  if (!isSearchableNote(note)) return;
  try {
    searchIndex.remove({ id: note.id });
  } catch {}
  searchIndex.add(noteToDocument(note));
}

export function removeSearchEntry(id) {
  if (!id) return;
  try {
    searchIndex.remove({ id });
  } catch {}
}

export function searchNotesIndex(query) {
  if (!query?.trim()) return [];
  const t = speed('search_notes_index');
  const result = searchIndex.search(query).map((result) => result.id).filter(Boolean);
  t?.end();
  return result;
}

export function getSearchIndexJSON() {
  return JSON.stringify(searchIndex.toJSON());
}

export function loadSearchIndex(json) {
  // MiniSearch v7 replaced the instance `import()` with the static
  // `loadJSON()` — passing the same options used at serialization time.
  searchIndex = MiniSearch.loadJSON(json, SEARCH_OPTIONS);
}
