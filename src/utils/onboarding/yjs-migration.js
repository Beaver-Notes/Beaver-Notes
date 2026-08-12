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

import { useStorage } from '@/lib/storage';
import { appendBatch } from '@/lib/native/yjs.js';
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
const FLUSH_EVERY = 20;

function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Collect converted updates and flush them in one batched IPC per chunk, so a
// large import is not N round-trips.
const pendingUpdates = [];

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
    pendingUpdates.push({ noteId: id, update });

    const searchText = extractTextFromContent(clean.content);
    const { content: _c, ...meta } = clean;
    await storage.set(`notes.${id}`, { ...meta, searchText });

    return true;
  }
  return false;
}

async function flushPendingUpdates(device) {
  if (pendingUpdates.length === 0) return;
  const entries = pendingUpdates.splice(0);
  await appendBatch(
    entries.map((e) => e.noteId),
    entries.map((e) => e.update),
    entries.map(() => device)
  );
}

/**
 * Move note content from KV into Yjs. Import-only: returns early once the
 * versioned flag is set, and only notes that still carry KV content (with an
 * empty Yjs doc) are touched — idempotent and cheap on subsequent runs.
 *
 * Runs sequentially and yields to the UI after every note: converting a large
 * vault builds a ProseMirror doc per note (CPU-heavy), and parallelizing it
 * with several large Y.Docs at once spiked the main thread and memory. The
 * import now takes a bit longer wall-clock but never freezes the app.
 *
 * @param {(progress: number, noteId: string) => void} [onProgress] 0-100.
 */
export async function migrateNotesContent(onProgress = null) {
  const flag = await storage.get(MIGRATION_FLAG, false, 'settings');
  if (flag) return 0;

  const notes = await storage.get('notes', {});
  const noteIds = Object.keys(notes).filter((id) => notes[id]?.content);

  if (noteIds.length === 0) {
    await storage.set(MIGRATION_FLAG, true, 'settings');
    return 0;
  }

  const schema = await ensureSchema();
  const device = getDeviceId();

  let migrated = 0;

  for (let i = 0; i < noteIds.length; i++) {
    const id = noteIds[i];
    try {
      if (await processNote(id, notes, schema)) migrated++;
    } catch (err) {
      console.warn(`[yjs-content] Failed for note ${id}:`, err);
    }

    onProgress?.(Math.round(((i + 1) / noteIds.length) * 100), id);

    if (pendingUpdates.length >= FLUSH_EVERY) {
      await flushPendingUpdates(device);
    }
    // Let the UI paint / respond between notes.
    await yieldToUi();
  }

  await flushPendingUpdates(device);
  await storage.set(MIGRATION_FLAG, true, 'settings');
  return migrated;
}
