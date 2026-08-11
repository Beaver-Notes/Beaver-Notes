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

function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function processNote(id, notes, schema) {
  const note = notes[id];
  if (!note.content) return false;

  const isLockedOrEncrypted =
    note.isLocked || isEncryptedContent(note.content);
  if (isLockedOrEncrypted) return false;

  const { prosemirrorJSONToYDoc } = await import('@tiptap/y-tiptap');
  const clean = stripTransientFields(note);
  const tempYdoc = prosemirrorJSONToYDoc(schema, clean.content, 'content');
  const frag = tempYdoc.getXmlFragment('content');

  const Y = await import('yjs');
  const snapshot = Y.encodeStateAsUpdate(tempYdoc);

  if (frag.length > 0 && snapshot.byteLength > 0) {
    await compactUpdates(id, snapshot);

    const searchText = extractTextFromContent(clean.content);
    const { content: _c, ...meta } = clean;
    await storage.set(`notes.${id}`, { ...meta, searchText });

    return true;
  } else {
    console.warn(
      `[yjs-migration] No usable Yjs content for note ${id}; keeping KV content.`
    );
    return false;
  }
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function runWithConcurrency(items, fn, concurrency) {
  const results = [];
  let index = 0;

  async function next() {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await fn(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => next());
  await Promise.all(workers);
  return results;
}

export async function migrateNotesContent() {
  const flag = await storage.get('yjs_migration_done', false, 'settings');
  if (flag) return 0;

  const notes = await storage.get('notes', {});
  const noteIds = Object.keys(notes).filter((id) => notes[id]?.content);

  if (noteIds.length === 0) {
    await storage.set('yjs_migration_done', true, 'settings');
    return 0;
  }

  const schema = await ensureSchema();

  let migrated = 0;

  const chunks = chunk(noteIds, 50);

  for (const chunkIds of chunks) {
    const results = await runWithConcurrency(
      chunkIds,
      async (id) => {
        try {
          return await processNote(id, notes, schema);
        } catch (err) {
          console.warn(`[yjs-migration] Failed for note ${id}:`, err);
          return false;
        }
      },
      4
    );

    migrated += results.filter(Boolean).length;

    await yieldToUi();
  }

  await storage.set('yjs_migration_done', true, 'settings');
  return migrated;
}
