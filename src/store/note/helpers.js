import { indexNote, removeNoteFromIndex } from '@/lib/native/search';
import {
  isEncryptedContent,
} from '@/utils/crypto/encryption.js';
import { useStorage } from '@/composable/storage.js';
import { trackChange } from '@/utils/sync';
import {
  encryptNoteForStorage,
  stripTransientFields,
} from '@/utils/note/serializer.js';
import { PluginRegistry } from '@/plugins/PluginRegistry';
import { useFolderStore } from '../folder';
import {
  indexNoteForSpotlight,
  deleteNoteFromSpotlight,
} from '@/utils/platform/spotlightSync.js';

export const storage = useStorage();

/**
 * Silently sync a note into the FTS index after it is written to storage.
 * Uses the pre-computed `searchText` field so no content serialisation is needed.
 * Errors are swallowed — a stale index degrades gracefully to no results.
 */
export function syncFtsIndex(note) {
  if (!note?.id || note.isLocked || isEncryptedContent(note.content)) return;
  indexNote(note.id, note.title || '', note.searchText || '').catch(() => {});
}

export async function trackNoteChange(id, note) {
  await trackChange(`notes.${id}`, stripTransientFields(note));
}

export async function saveNote(id, noteData) {
  const stripped = stripTransientFields(noteData);
  const content = await PluginRegistry.runSaveTransforms(stripped.content, id);
  const toStore = await encryptNoteForStorage({ ...stripped, content });
  await storage.set(`notes.${id}`, toStore);
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
