/**
 * Note hydration and serialization helpers.
 *
 * Responsible for the transformation layer between what is persisted on disk
 * and what lives in the Pinia store in memory:
 *   - stripping transient (computed) fields before write
 *   - rebuilding computed fields (cardPreview, searchText) after read
 *   - handling app-level encryption transparently on load/save
 */
import {
  buildCardPreview,
  EMPTY_CARD_PREVIEW,
} from '@/utils/note/cardPreview.js';
import {
  isEncryptionEnabled,
  ensureKeyReadyForWrite,
  decryptContent,
  encryptContent,
  isEncryptedContent,
} from '@/utils/crypto/encryption.js';

let _appKeyRaw = null;
let _decryptWorkerInFlight = null;

/**
 * Yield to UI thread to prevent blocking.
 */
function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Try to get the raw app key for worker-based decryption.
 * Returns null if not available.
 */
export function getAppKeyRaw() {
  return _appKeyRaw;
}

/**
 * Set the raw app key for worker-based decryption.
 * Called after successful unlock.
 */
export function setAppKeyRaw(key) {
  _appKeyRaw = key;
}

/**
 * Extracts a flat plain-text string from a ProseMirror content tree.
 * Used to build `searchText` so search never needs to JSON.stringify content.
 * Also exported for use as a defensive fallback in search UI.
 */
export function extractTextFromContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;

  const nodes = Array.isArray(content) ? content : content.content || [];
  const parts = [];

  function visit(node) {
    if (!node) return;
    if (node.type === 'text' && node.text) {
      parts.push(node.text);
      return;
    }
    const children = Array.isArray(node.content) ? node.content : [];
    for (const child of children) visit(child);
  }

  for (const node of nodes) visit(node);
  return parts.join(' ');
}

/**
 * Removes runtime-only fields (e.g. `cardPreview`, `searchText`) that must
 * not be persisted to storage.
 */
export function stripTransientFields(note) {
  if (!note || typeof note !== 'object') return note;
  // `cardPreview` is now persisted (it is rebuilt from structured content and
  // would otherwise be lost after the Yjs migration moved content out of KV).
  // `searchText` remains a deprecated transient field.
  const { searchText: _searchText, ...persistedNote } = note;
  return persistedNote;
}

/**
 * Attaches computed, in-memory fields to a note (`cardPreview`, `searchText`).
 * Always call this after loading or mutating a note before storing it in state.
 */
export function hydrateNote(note) {
  if (!note || typeof note !== 'object') return note;

  const persisted = stripTransientFields(note);
  const hidden = persisted.isLocked || isEncryptedContent(persisted.content);

  // Fast path: if the note already has both a cardPreview and a searchText,
  // return immediately without any content traversal.
  if (!hidden && persisted.cardPreview && persisted.searchText) {
    return { ...persisted, cardPreview: persisted.cardPreview, searchText: persisted.searchText };
  }

  const previewText = hidden
    ? ''
    : (persisted.preview ||
      persisted.searchText ||
      extractTextFromContent(persisted.content) ||
      '');

  // Prefer a persisted structured `cardPreview` (styled blocks). Rebuild it
  // from structured content when available, otherwise fall back to a flat
  // preview (legacy `searchText` / cross-device `preview`).
  let cardPreview = persisted.cardPreview;
  if (!hidden && !cardPreview) {
    if (persisted.content) {
      cardPreview = buildCardPreview(persisted.content);
    } else if (previewText) {
      cardPreview = buildCardPreview(previewText);
    }
  }
  if (!cardPreview) cardPreview = EMPTY_CARD_PREVIEW;

  return {
    ...persisted,
    cardPreview,
    searchText: previewText,
  };
}

/**
 * If the note's content is encrypted at the app level, decrypts it in-place
 * for in-memory use. Returns the note unchanged if the key is not loaded yet.
 */
export async function decryptNoteForMemory(note) {
  if (!isEncryptedContent(note.content)) return note;
  try {
    const decrypted = await decryptContent(note.content);
    if (decrypted === null) return note;
    return { ...note, content: decrypted };
  } catch (e) {
    console.error('[noteSerializer] decryptNoteForMemory failed:', e);
    return { ...note, decryptionError: true };
  }
}

/**
 * Batch decrypt multiple notes with UI yielding to prevent stalls.
 * Uses worker-based decryption when available for better performance.
 * @param {Array} notes - Array of note objects
 * @param {Object} options - { onProgress, batchSize, signal }
 * @returns {Array} Decrypted notes in same order
 */
export async function batchDecryptNotesForMemory(notes, options = {}) {
  const { onProgress, batchSize = 5, signal } = options;
  const results = Array.from({ length: notes.length });
  let processed = 0;

  for (let i = 0; i < notes.length; i += batchSize) {
    if (signal?.aborted) break;

    const batch = notes.slice(i, i + batchSize);
    const _batchResults = await Promise.all(
      batch.map(async (note, idx) => {
        const noteIndex = i + idx;
        try {
          const decrypted = await decryptNoteForMemory(note);
          results[noteIndex] = hydrateNote(decrypted);
        } catch {
          results[noteIndex] = hydrateNote({ ...note, decryptionError: true });
        }
        processed++;
        onProgress?.({ processed, total: notes.length, id: note.id });
        return results[noteIndex];
      })
    );

    await yieldToUi();
  }

  return results;
}

/**
 * If app-level encryption is active, encrypts the note's content before it is
 * written to storage. Uses a Web Worker so the main thread never blocks.
 * Throws if the encryption key is locked.
 */
export async function encryptNoteForStorage(note) {
  if (!isEncryptionEnabled()) return note;
  await ensureKeyReadyForWrite();
  if (note?.content) {
    return { ...note, content: await encryptContent(note.content) };
  }
  return note;
}
