/** Write ProseMirror JSON into Yjs doc at creation/import. Yjs is only content store, no later conversion. */

import * as Y from 'yjs';
import { appendUpdate, appendBatch, compactUpdates } from '@/lib/native/yjs.js';
import { isEncryptedContent } from '@/utils/crypto/encryption.js';

let helpersPromise = null;
function getHelpers() {
  if (!helpersPromise) helpersPromise = import('@/lib/yjs/helpers.js');
  return helpersPromise;
}

async function encodeContentUpdate(schema, content) {
  // Only plaintext ProseMirror JSON is writable to Yjs. Locked notes keep
  // their encrypted content elsewhere; their doc is empty until unlocked.
  if (!content || typeof content !== 'object' || isEncryptedContent(content)) {
    return null;
  }
  const { prosemirrorJSONToYDoc } = await import('@tiptap/y-tiptap');
  const tempYdoc = prosemirrorJSONToYDoc(schema, content, 'content');
  const update = Y.encodeStateAsUpdate(tempYdoc);
  return update.byteLength > 0 ? update : null;
}

/**
 * Persist a single note's content into its Yjs doc (one IPC).
 */
export async function writeNoteContentToYjs(noteId, content) {
  if (!noteId || !content || typeof content !== 'object') return;
  const helpers = await getHelpers();
  const schema = await helpers.ensureSchema();
  const update = await encodeContentUpdate(schema, content);
  if (!update) return;
  await appendUpdate(noteId, update, helpers.getDeviceId());
}

/**
 * Persist many notes' content in a single batched IPC (used by imports).
 */
export async function writeNotesContentToYjs(notes) {
  if (!notes?.length) return;
  const helpers = await getHelpers();
  const schema = await helpers.ensureSchema();
  const entries = [];
  for (const note of notes) {
    if (!note?.id || !note.content || typeof note.content !== 'object') {
      continue;
    }
    const update = await encodeContentUpdate(schema, note.content);
    if (update) entries.push({ noteId: note.id, update });
  }
  if (entries.length === 0) return;
  const device = helpers.getDeviceId();
  await appendBatch(
    entries.map((e) => e.noteId),
    entries.map((e) => e.update),
    entries.map(() => device)
  );
}

/** Replace note Yjs content with given full content. Appends full-state update (correct on empty, duplicates otherwise). Compacts instead, unsafe live. */
export async function replaceNoteContentInYjs(noteId, content) {
  if (!noteId || !content || typeof content !== 'object') return;
  const helpers = await getHelpers();
  const schema = await helpers.ensureSchema();
  const update = await encodeContentUpdate(schema, content);
  if (!update) return;
  await compactUpdates(noteId, update);
}
