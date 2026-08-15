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
import { ensureSchema, getDeviceId } from '@/lib/yjs/helpers.js';
import {
  isAppEncryptedEnvelope,
  decryptContent,
} from '@/utils/crypto/encryption.js';
import * as Y from 'yjs';

const storage = useStorage();

const MIGRATION_FLAG = 'yjs_content_sync_v2';
const FLUSH_EVERY = 20;

// Note IDs must survive the cloud sync key pattern and the collaboration note
// schema. Anything outside [A-Za-z0-9_-] (spaces, slashes, URLs, unicode) would
// silently strand a note in KV: the local appendBatch accepts it, but cloud
// sync and collaboration reject it. Legacy data can carry such IDs (e.g. a full
// URL stored as the note key with an empty `id` field), so they are repaired
// here rather than skipped.
const VALID_NOTE_ID = /^[A-Za-z0-9_-]{1,256}$/;

function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Collect converted updates and flush them in one batched IPC per chunk, so a
// large import is not N round-trips.
const pendingUpdates = [];

async function processNote(id, notes, schema, log) {
  const note = notes[id];
  if (!note) return { ok: false, reason: 'missing' };
  if (!note.content) return { ok: false, reason: 'no-content' };
  // Per-note password locks can't be auto-decrypted — keep their KV content.
  if (note.isLocked) return { ok: false, reason: 'locked' };

  let content = note.content;
  if (isAppEncryptedEnvelope(content)) {
    const decrypted = await decryptContent(content).catch(() => null);
    if (!decrypted || typeof decrypted !== 'object') {
      log(`[yjs-content] Skipped note ${id}: could not decrypt content`);
      return { ok: false, reason: 'decrypt-failed' };
    }
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

    return { ok: true };
  }
  return { ok: false, reason: 'empty' };
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
 * Move note content from KV into Yjs. Runs on every onboarding import and on
 * subsequent app starts while notes remain in KV: per-note conversion is
 * tracked so a note that failed once (e.g. could not be decrypted, or carried
 * an invalid ID) is retried on the next run instead of being stranded.
 *
 * Invalid or empty note IDs are repaired with a fresh nanoid before conversion
 * and the KV row is re-keyed, so the note migrates cleanly and survives cloud
 * sync / collaboration.
 *
 * Runs sequentially and yields to the UI after every note: converting a large
 * vault builds a ProseMirror doc per note (CPU-heavy), and parallelizing it
 * with several large Y.Docs at once spiked the main thread and memory.
 *
 * @param {(progress: number, noteId: string) => void} [onProgress] 0-100.
 */
export async function migrateNotesContent(onProgress = null) {
  const notes = await storage.get('notes', {});
  const noteIds = Object.keys(notes).filter((id) => notes[id]?.content);

  if (noteIds.length === 0) {
    await storage.set(MIGRATION_FLAG, true, 'settings');
    return 0;
  }

  const schema = await ensureSchema();
  const device = getDeviceId();

  const log = (msg) => console.warn(msg);

  let migrated = 0;
  let repaired = 0;

  for (let i = 0; i < noteIds.length; i++) {
    const id = noteIds[i];
    let workingId = id;
    let note = notes[id];

    try {
      // Repair invalid/empty IDs: re-key the KV row under a fresh nanoid so the
      // note can migrate and sync. The note object's own `id` (if missing or
      // wrong) is set to the new id too.
      if (!VALID_NOTE_ID.test(workingId) || !note?.id || !VALID_NOTE_ID.test(note.id)) {
        const { nanoid } = await import('nanoid');
        workingId = nanoid();
        if (note?.id && note.id !== workingId) {
          // Keep a link from the old id to the repaired one so any references
          // to the original key still resolve.
          const { content: _c, id: _oldId, ...rest } = note;
          note = { ...rest, id: workingId, content: note.content };
          await storage.set(`notes.${workingId}`, note);
          if (workingId !== id) {
            await storage.delete(`notes.${id}`);
          }
        } else if (!note?.id) {
          note = { ...note, id: workingId };
          await storage.set(`notes.${workingId}`, note);
          if (workingId !== id) {
            await storage.delete(`notes.${id}`);
          }
        }
        repaired++;
        log(`[yjs-content] Repaired note id "${id}" -> "${workingId}"`);
      }

      const result = await processNote(workingId, { [workingId]: note }, schema, log);
      if (result.ok) migrated++;
      else if (result.reason !== 'no-content' && result.reason !== 'empty') {
        // decrypt-failed / locked / missing — leave in KV for a future retry,
        // but surface the reason now.
        log(`[yjs-content] Note ${workingId} not migrated: ${result.reason}`);
      }
    } catch (err) {
      log(`[yjs-content] Failed for note ${id}:`, err);
    }

    onProgress?.(Math.round(((i + 1) / noteIds.length) * 100), workingId);

    if (pendingUpdates.length >= FLUSH_EVERY) {
      await flushPendingUpdates(device);
    }
    // Let the UI paint / respond between notes.
    await yieldToUi();
  }

  await flushPendingUpdates(device);
  // The global flag is informational only — per-note retry means failed notes
  // are picked up on the next launch regardless.
  await storage.set(MIGRATION_FLAG, true, 'settings');
  return { migrated, repaired };
}
