/**
 * Realtime conversion of legacy Electron note content (plaintext ProseMirror
 * JSON) into per-note Yjs docs. Note content never touches the KV store —
 * it is converted and batched straight into Yjs at import time.
 */

import * as Y from 'yjs';
import { appendBatch } from '@/lib/native/yjs.js';
import { ensureSchema, getDeviceId } from '@/lib/yjs/helpers.js';
import { buildNotePreview } from '@/utils/note/cardPreview.js';
import { extractTextFromContent } from '@/utils/note/serializer.js';
import { isAppEncryptedEnvelope } from '@/utils/crypto/encryption.js';

const CHUNK_SIZE = 20;

const ASSET_NODE_TYPES = new Set(['image', 'Audio', 'Video', 'fileEmbed']);

/**
 * Walk a ProseMirror JSON tree and normalize broken asset paths from legacy
 * v4 versions that stored full filesystem paths or relative paths without
 * the protocol prefix.
 */
function normalizeAssetPaths(node, noteId) {
  if (!node || typeof node !== 'object') return;

  if (ASSET_NODE_TYPES.has(node.type) && node.attrs?.src) {
    const src = node.attrs.src;

    // Already correct protocol — leave as-is
    if (src.startsWith('assets://') || src.startsWith('file-assets://')) {
      return;
    }

    let fileName = src;

    // Full filesystem path: /Users/.../notes-assets/{noteId}/{file}
    // or /Users/.../file-assets/{noteId}/{file}
    const fsMatch = src.match(/(?:notes-assets|file-assets)\/([^/]+\/)?([^/]+)$/);
    if (fsMatch) {
      // fsMatch[1] = "noteId/" (if present), fsMatch[2] = filename
      fileName = fsMatch[2];
    } else {
      // Relative path like "file-assets/noteId/file" or "notes-assets/file"
      // Strip leading directory prefix to get the filename
      const relMatch = src.match(/^(?:notes-assets|file-assets)(?:\/[^/]+)*\/([^/]+)$/);
      if (relMatch) {
        fileName = relMatch[1];
      }
    }

    node.attrs = { ...node.attrs, src: `assets://${noteId}/${fileName}` };
    return;
  }

  // Recurse into child content
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      normalizeAssetPaths(child, noteId);
    }
  }
}

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
 * @param {{
 *   onProgress?: (done: number, total: number, id: string) => void,
 *   legacyPassword?: string,
 *   alreadyConvertedIds?: Set<string>,
 * }} [opts]
 * @returns {Promise<{converted: number, skipped: number, failures: string[]}>}
 */
export async function convertLegacyNotesToYjs(
  notes = [],
  { onProgress, legacyPassword, alreadyConvertedIds } = {}
) {
  const schema = await ensureSchema();
  const device = getDeviceId();
  const failures = [];
  let converted = 0;
  let skipped = 0;
  const alreadyConverted =
    alreadyConvertedIds instanceof Set ? alreadyConvertedIds : new Set();

  for (let i = 0; i < notes.length; i += CHUNK_SIZE) {
    const chunk = notes.slice(i, i + CHUNK_SIZE);
    const entries = [];
    for (const note of chunk) {
      if (alreadyConverted.has(note.id)) {
        skipped++;
        continue;
      }
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
          const { isAppEncryptedEnvelope, decryptContent } = await import(
            '@/utils/crypto/encryption.js'
          );
          // App-encrypted envelope (ae:3/ae:6) — decrypt with the workspace
          // key, which is always available during onboarding. These appear
          // when a legacy config.json was previously re-encrypted by
          // migrateLegacyLockedNotes; the legacy password does not apply to
          // them, so this branch must run regardless of legacyPassword.
          if (isAppEncryptedEnvelope(note.content)) {
            content = await decryptContent(note.content);
          } else {
            // Legacy CryptoJS or JSON envelope — decrypt with the legacy
            // password captured during onboarding.
            if (!legacyPassword) {
              skipped++;
              continue;
            }
            const { decryptNoteWithPassword } = await import(
              '@/utils/migration/legacyElectron.js'
            );
            const ciphertext = note.content.content?.[0];
            if (typeof ciphertext !== 'string') {
              throw new Error('Locked note has no decryptable ciphertext');
            }
            const { plaintext } = await decryptNoteWithPassword(
              ciphertext,
              legacyPassword
            );
            content = JSON.parse(plaintext);
          }
        }

        normalizeAssetPaths(content, note.id);

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

/**
 * Ensure each note in a legacy notes map carries cardPreview/preview/searchText
 * before it is passed to seedWorkspaceDocFromData. Mutates the map in place.
 * Locked/encrypted notes get an empty preview (hidden).
 *
 * @param {Record<string, object>} notesMap id -> note meta (content may be ProseMirror JSON)
 * @returns {Record<string, object>} same map
 */
export function ensureLegacyNotesPreview(notesMap) {
  if (!notesMap || typeof notesMap !== 'object') return notesMap;
  for (const note of Object.values(notesMap)) {
    if (!note || typeof note !== 'object') continue;
    // Idempotency: non-empty preview is final, but EMPTY (blocks: []) is upgradeable.
    if (note.cardPreview?.blocks?.length > 0) continue;
    const content = note.content;
    // ae:3 / ae:6 envelopes are app-encrypted and must be hidden even when
    // isLocked is not set or the legacy string-prefix heuristic misses them.
    // Use the canonical helper when available, with an inline fallback so the
    // function stays correct even if the helper is mocked or unavailable.
    let isAeEnvelope = false;
    try {
      isAeEnvelope = isAppEncryptedEnvelope(content) || content?.ae === 3 || content?.ae === 6;
    } catch {
      isAeEnvelope = content?.ae === 3 || content?.ae === 6;
    }
    const hasLegacyCipher =
      typeof content?.content?.[0] === 'string' &&
      (content.content[0].startsWith('U2FsdGVk') || content.content[0].startsWith('{'));
    const isLocked = note.isLocked === true || isAeEnvelope || hasLegacyCipher;
    // For app-encrypted envelopes content is not plaintext JSON for preview;
    // buildNotePreview with hidden:true will produce EMPTY_CARD_PREVIEW.
    let contentForPreview = note.content;
    // If content is an encrypted envelope (ae:3/ae:6) or legacy cipher string,
    // don't use it as structured content — fall back to preview/searchText text.
    if (isLocked) contentForPreview = null;
    else if (contentForPreview && typeof contentForPreview === 'object' && contentForPreview.type !== 'doc') {
      // Non-ProseMirror envelope — treat as missing structured content.
      contentForPreview = null;
    }
    const { cardPreview, preview } = buildNotePreview({
      content: contentForPreview,
      preview: note.preview,
      searchText: note.searchText,
      hidden: isLocked,
    });
    note.cardPreview = cardPreview;
    if (preview !== undefined) note.preview = preview;
    if (!isLocked) {
      const searchText = extractTextFromContent(contentForPreview) || note.searchText || preview || '';
      if (searchText) note.searchText = searchText;
    } else {
      note.preview = '';
      note.searchText = '';
    }
  }
  return notesMap;
}
