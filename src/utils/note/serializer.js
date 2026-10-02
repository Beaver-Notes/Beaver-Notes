/**
 * Note hydration and serialization: the transformation layer between what is
 * persisted on disk and what lives in the Pinia store (strip transient fields
 * on write, rebuild computed fields on read, transparent app-level encryption).
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

function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Flat plain-text from a ProseMirror tree; builds `searchText` so search never
 * JSON.stringifies content. Also a defensive fallback in search UI.
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
  // `cardPreview` IS persisted (rebuilt from structured content, otherwise
  // lost after the Yjs migration moved content out of KV); `searchText` stays transient.
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
  if (persisted.dir !== 'ltr' && persisted.dir !== 'rtl') persisted.dir = 'auto';
  const hidden = persisted.isLocked || isEncryptedContent(persisted.content);

  // Fast path: both computed fields present, skip traversal.
  if (!hidden && persisted.cardPreview && persisted.searchText) {
    return { ...persisted, cardPreview: persisted.cardPreview, searchText: persisted.searchText };
  }

  const previewText = hidden
    ? ''
    : (persisted.preview ||
      persisted.searchText ||
      extractTextFromContent(persisted.content) ||
      '');

  // Prefer persisted structured `cardPreview`; rebuild from content when
  // possible, else fall back to a flat preview (legacy searchText / preview).
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
 * written to storage. Throws if the encryption key is locked.
 */
export async function encryptNoteForStorage(note) {
  if (!isEncryptionEnabled()) return note;
  await ensureKeyReadyForWrite();
  if (note?.content) {
    return { ...note, content: await encryptContent(note.content) };
  }
  return note;
}
