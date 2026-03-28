/**
 * Note hydration and serialization helpers.
 *
 * Responsible for the transformation layer between what is persisted on disk
 * and what lives in the Pinia store in memory:
 *   - stripping transient (computed) fields before write
 *   - rebuilding computed fields (cardPreview) after read
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
 * Removes runtime-only fields (e.g. `cardPreview`) that must not be persisted.
 */
export function stripTransientFields(note) {
  if (!note || typeof note !== 'object') return note;
  const { cardPreview, ...persistedNote } = note;
  return persistedNote;
}

/**
 * Attaches computed, in-memory fields to a note (currently `cardPreview`).
 * Always call this after loading or mutating a note before storing it in state.
 */
export function hydrateNote(note) {
  if (!note || typeof note !== 'object') return note;

  const persisted = stripTransientFields(note);
  const shouldHidePreview =
    persisted.isLocked || isAppEncryptedContent(persisted.content);

  return {
    ...persisted,
    cardPreview: shouldHidePreview
      ? EMPTY_CARD_PREVIEW
      : buildCardPreview(persisted.content),
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
