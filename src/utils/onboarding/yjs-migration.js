/**
 * One-time conversion of note content into the note's Yjs doc. Yjs is the only
 * content store and encryption is mandatory — this runs only when data is
 * *imported* (legacy Electron vaults write notes into KV directly), never as a
 * runtime step.
 *
 * App-encrypted content (`ae:3` legacy envelope, `ae:6` raw bytes) is decrypted
 * with the loaded app key before conversion; per-note password-locked notes are
 * skipped (they require the user's per-note passphrase).
 */

import { useStorage } from '@/composable/storage';
import { appendUpdate } from '@/lib/native/yjs.js';
import {
  extractTextFromContent,
  stripTransientFields,
} from '@/utils/note/serializer.js';
import { ensureSchema, getDeviceId } from '@/utils/yjs-helpers.js';
import {
  isAppEncryptedEnvelope,
  decryptContent,
} from '@/utils/crypto/encryption.js';
import * as Y from 'yjs';

const storage = useStorage();

const MIGRATION_FLAG = 'yjs_content_sync_v2';

function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function processNote(id, notes, schema) {
  const note = notes[id];
  if (!note.content) return false;
  // Per-note password locks can't be auto-decrypted — keep their KV content.
  if (note.isLocked) return false;

  let content = note.content;
  if (isAppEncryptedEnvelope(content)) {
    const decrypted = await decryptContent(content).catch(() => null);
    if (!decrypted || typeof decrypted !== 'object') return false;
    content = decrypted;
  }

  const clean = stripTransientFields({ ...note, content });
  const { prosemirrorJSONToYDoc } = await import('@tiptap/y-tiptap');
  const tempYdoc = prosemirrorJSONToYDoc(schema, clean.content, 'content');
  const frag = tempYdoc.getXmlFragment('content');
  const update = Y.encodeStateAsUpdate(tempYdoc);

  if (frag.length > 0 && update.byteLength > 0) {
    await appendUpdate(id, update, getDeviceId());

    const searchText = extractTextFromContent(clean.content);
    const { content: _c, ...meta } = clean;
    await storage.set(`notes.${id}`, { ...meta, searchText });

    return true;
  }
  return false;
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

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => next()
  );
  await Promise.all(workers);
  return results;
}

/**
 * Move note content from KV into Yjs. Import-only: returns early once the
 * versioned flag is set, and only notes that still carry KV content (with an
 * empty Yjs doc) are touched — idempotent and cheap on subsequent runs.
 */
export async function migrateNotesContent() {
  const flag = await storage.get(MIGRATION_FLAG, false, 'settings');
  if (flag) return 0;

  const notes = await storage.get('notes', {});
  const noteIds = Object.keys(notes).filter((id) => notes[id]?.content);

  if (noteIds.length === 0) {
    await storage.set(MIGRATION_FLAG, true, 'settings');
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
          console.warn(`[yjs-content] Failed for note ${id}:`, err);
          return false;
        }
      },
      4
    );

    migrated += results.filter(Boolean).length;

    await yieldToUi();
  }

  await storage.set(MIGRATION_FLAG, true, 'settings');
  return migrated;
}
