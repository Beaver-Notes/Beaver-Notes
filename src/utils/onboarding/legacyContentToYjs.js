/**
 * Realtime conversion of legacy Electron note content (plaintext ProseMirror
 * JSON) into per-note Yjs docs. Note content never touches the KV store —
 * it is converted and batched straight into Yjs at import time.
 */

import * as Y from 'yjs';
import { appendBatch } from '@/lib/native/yjs.js';
import { ensureSchema, getDeviceId } from '@/lib/yjs/helpers.js';

const CHUNK_SIZE = 20;

function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Encode a single note's plaintext ProseMirror content as a Yjs state update.
 * Returns null when the note has no usable content.
 */
export async function convertLegacyNoteToUpdate(schema, content) {
  if (!content || typeof content !== 'object') return null;
  const { prosemirrorJSONToYDoc } = await import('@tiptap/y-tiptap');
  const tempYdoc = prosemirrorJSONToYDoc(schema, content, 'content');
  const frag = tempYdoc.getXmlFragment('content');
  const update = Y.encodeStateAsUpdate(tempYdoc);
  if (frag.length === 0 || update.byteLength === 0) return null;
  return update;
}

/**
 * Convert an array of legacy notes into Yjs docs, batching `appendBatch`
 * calls in chunks and yielding to the UI between chunks.
 *
 * @param {Array<{id: string, content: object}>} notes
 * @param {{onProgress?: (done: number, total: number, id: string) => void, legacyPassword?: string}} [opts]
 * @returns {Promise<{converted: number, skipped: number, failures: string[]}>}
 */
export async function convertLegacyNotesToYjs(notes = [], { onProgress, legacyPassword } = {}) {
  const schema = await ensureSchema();
  const device = getDeviceId();
  const failures = [];
  let converted = 0;
  let skipped = 0;

  for (let i = 0; i < notes.length; i += CHUNK_SIZE) {
    const chunk = notes.slice(i, i + CHUNK_SIZE);
    const entries = [];
    for (const note of chunk) {
      if (!note?.id || !note.content || typeof note.content !== 'object') {
        skipped++;
        continue;
      }
      try {
        let content = note.content;
        const isLocked =
          note.isLocked === true ||
          (typeof note.content.content?.[0] === 'string' &&
            (note.content.content[0].startsWith('U2FsdGVk') ||
              note.content.content[0].startsWith('{')));

        if (isLocked) {
          if (!legacyPassword) {
            skipped++;
            continue;
          }
          const { decryptNoteWithPassword } = await import('@/utils/migration/legacyElectron.js');
          const ciphertext = note.content.content?.[0];
          const { plaintext } = await decryptNoteWithPassword(ciphertext, legacyPassword);
          content = JSON.parse(plaintext);
        }

        const update = await convertLegacyNoteToUpdate(schema, content);
        if (update) {
          entries.push({ noteId: note.id, update });
          converted++;
        } else {
          skipped++;
        }
      } catch (err) {
        console.warn(`[legacy-content] failed to convert note ${note.id}:`, err?.message || err);
        failures.push(note.id);
      }
    }
    if (entries.length > 0) {
      await appendBatch(
        entries.map((e) => e.noteId),
        entries.map((e) => e.update),
        entries.map(() => device)
      );
    }
    onProgress?.(Math.min(i + CHUNK_SIZE, notes.length), notes.length, entries[0]?.noteId || '');
    await yieldToUi();
  }

  return { converted, skipped, failures };
}
