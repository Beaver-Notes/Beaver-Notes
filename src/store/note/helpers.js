import { indexNote, removeNoteFromIndex } from '@/lib/native/search';
import {
  isEncryptedContent,
} from '@/utils/crypto/encryption.js';
import { useFolderStore } from '../folder';
import {
  indexNoteForSpotlight,
  deleteNoteFromSpotlight,
} from '@/utils/platform/spotlightSync.js';

/**
 * Silently sync a note into the FTS index after it is written to storage.
 * Uses the pre-computed `searchText` field so no content serialisation is needed.
 * Errors are swallowed — a stale index degrades gracefully to no results.
 */
export function syncFtsIndex(note) {
  if (!note?.id || note.isLocked || isEncryptedContent(note.content)) return;
  indexNote(note.id, note.title || '', note.searchText || '').catch(() => {});
}

export async function saveNote(id, noteData) {
  syncFtsIndex(noteData);
  indexNoteForSpotlight(noteData);
}

export async function resolveFolderId(folderId) {
  if (folderId === undefined || folderId === null) return null;
  return useFolderStore().exists(folderId) ? folderId : null;
}

export async function removeNoteFromFts(id) {
  removeNoteFromIndex(id).catch(() => {});
  deleteNoteFromSpotlight(id);
}
