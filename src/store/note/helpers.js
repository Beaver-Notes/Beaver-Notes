import { indexNote, removeNoteFromIndex } from '@/lib/native/search';
import {
  isAppEncryptionEnabled,
  isAppEncryptedContent,
} from '@/utils/appCrypto.js';
import { useStorage } from '@/composable/storage.js';
import { trackChange } from '@/utils/sync';
import {
  encryptNoteForStorage,
  stripTransientFields,
} from '@/utils/noteSerializer.js';
import { useFolderStore } from '../folder';

export const storage = useStorage();

/**
 * Silently sync a note into the FTS index after it is written to storage.
 * Uses the pre-computed `searchText` field so no content serialisation is needed.
 * Errors are swallowed — a stale index degrades gracefully to no results.
 */
export function syncFtsIndex(note) {
  if (!note?.id || note.isLocked || isAppEncryptedContent(note.content)) return;
  indexNote(note.id, note.title || '', note.searchText || '').catch(() => {});
}

export async function trackNoteChange(id, note) {
  await trackChange(`notes.${id}`, stripTransientFields(note));
}

export async function saveNote(id, noteData) {
  const toStore = await encryptNoteForStorage(stripTransientFields(noteData));
  await storage.set(`notes.${id}`, toStore);
  syncFtsIndex(noteData);
}

export async function resolveFolderId(folderId) {
  if (folderId === undefined || folderId === null) return null;
  return useFolderStore().exists(folderId) ? folderId : null;
}

export async function removeNoteFromFts(id) {
  removeNoteFromIndex(id).catch(() => {});
}
