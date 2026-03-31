/**
 * Note hydration and serialization helpers.
 *
 * Responsible for the transformation layer between what is persisted on disk
 * and what lives in the Pinia store in memory:
 *   - stripping transient (computed) fields before write
 *   - rebuilding computed fields (cardPreview, searchText) after read
 *   - handling app-level encryption transparently on load/save
 */
import { buildCardPreview, EMPTY_CARD_PREVIEW } from '@/utils/cardPreview.js';
import {
  isAppEncryptionEnabled,
  isAppKeyLoaded,
  encryptContent,
  decryptContent,
  isAppEncryptedContent,
} from '@/utils/appCrypto.js';

/**
 * Extracts a flat plain-text string from a ProseMirror content tree.
 * Used to build `searchText` so search never needs to JSON.stringify content.
 * Also exported for use as a defensive fallback in search UI.
 */
export function extractTextFromContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;

  const nodes = Array.isArray(content) ? content : (content.content || []);
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
  const { cardPreview, searchText, ...persistedNote } = note;
  return persistedNote;
}

/**
 * Attaches computed, in-memory fields to a note (`cardPreview`, `searchText`).
 * Always call this after loading or mutating a note before storing it in state.
 */
export function hydrateNote(note) {
  if (!note || typeof note !== 'object') return note;

  const persisted = stripTransientFields(note);
  const hidden = persisted.isLocked || isAppEncryptedContent(persisted.content);

  return {
    ...persisted,
    cardPreview: hidden ? EMPTY_CARD_PREVIEW : buildCardPreview(persisted.content),
    searchText: hidden ? '' : extractTextFromContent(persisted.content),
  };
}

/**
 * If the note's content is encrypted at the app level, decrypts it in-place
 * for in-memory use. Returns the note unchanged if the key is not loaded yet.
 */
export async function decryptNoteForMemory(note) {
  if (!isAppEncryptedContent(note.content)) return note;
  const decrypted = await decryptContent(note.content);
  if (decrypted === null) return note; // key not loaded — keep encrypted in memory
  return { ...note, content: decrypted };
}

/**
 * If app-level encryption is active, encrypts the note's content before it is
 * written to storage. Throws if the encryption key is locked.
 */
export async function encryptNoteForStorage(note) {
  if (!isAppEncryptionEnabled()) return note;
  if (!isAppKeyLoaded()) {
    throw new Error(
      'App encryption key is locked. Unlock app encryption in Settings before editing notes.'
    );
  }
  if (isAppEncryptedContent(note.content)) return note; // already encrypted
  const encrypted = await encryptContent(note.content);
  return { ...note, content: encrypted };
}
