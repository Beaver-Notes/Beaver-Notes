/**
 * One-time batch migration: reads existing note content from the KV store
 * and writes it into the note_content (Yjs) table, then strips content from KV.
 *
 * Runs during onboarding after legacy data has been imported so that every
 * note's content lives in Yjs before the user opens any note.
 */

import { useStorage } from '@/composable/storage';
import { compactUpdates } from '@/lib/native/yjs.js';
import {
  extractTextFromContent,
  stripTransientFields,
} from '@/utils/note/serializer.js';
import { ensureSchema } from '@/utils/yjs-helpers.js';
import { isEncryptedContent } from '@/utils/crypto/encryption.js';

const storage = useStorage();

export async function migrateNotesContent() {
  const flag = await storage.get('yjs_migration_done', false, 'settings');
  if (flag) return 0;

  const notes = await storage.get('notes', {});
  const noteIds = Object.keys(notes).filter((id) => notes[id]?.content);

  if (noteIds.length === 0) {
    await storage.set('yjs_migration_done', true, 'settings');
    return 0;
  }

  const { prosemirrorJSONToYDoc } = await import('@tiptap/y-tiptap');
  const schema = await ensureSchema();

  let migrated = 0;

  for (const id of noteIds) {
    const note = notes[id];
    if (!note.content) continue;

    // Locked / app-encrypted notes keep their ciphertext in the KV store.
    // The new storage model never places ciphertext into the per-note Yjs
    // doc, and converting ciphertext to ProseMirror JSON would destroy it.
    // Leave these notes untouched in KV so the content is not lost.
    const isLockedOrEncrypted =
      note.isLocked || isEncryptedContent(note.content);
    if (isLockedOrEncrypted) {
      console.log(`[yjs-migration] Skipping locked/encrypted note ${id}.`);
      continue;
    }

    try {
      const clean = stripTransientFields(note);
      const tempYdoc = prosemirrorJSONToYDoc(schema, clean.content, 'content');
      const frag = tempYdoc.getXmlFragment('content');

      const Y = await import('yjs');
      const snapshot = Y.encodeStateAsUpdate(tempYdoc);

      // Only strip the KV content once we have a real, non-empty Yjs version
      // of it. If the conversion produced an empty fragment (e.g. unsupported
      // node types), keep the KV content so it is not destroyed.
      if (frag.length > 0 && snapshot.byteLength > 0) {
        await compactUpdates(id, snapshot);

        // Strip content from KV but preserve searchText for card previews
        const searchText = extractTextFromContent(clean.content);
        const { content: _c, ...meta } = clean;
        await storage.set(`notes.${id}`, { ...meta, searchText });

        migrated++;
      } else {
        console.warn(
          `[yjs-migration] No usable Yjs content for note ${id}; keeping KV content.`
        );
      }
    } catch (err) {
      console.warn(`[yjs-migration] Failed for note ${id}:`, err);
    }
  }

  await storage.set('yjs_migration_done', true, 'settings');
  console.log(`[yjs-migration] Migrated ${migrated}/${noteIds.length} notes.`);
  return migrated;
}
