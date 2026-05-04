import { isAppEncryptedContent } from '@/utils/appCrypto.js';
import {
  hydrateNote,
  decryptNoteForMemory,
  stripTransientFields,
} from '@/utils/noteSerializer.js';
import { saveNote, storage } from './helpers';

export async function decryptAllNotesForAppEncryption(options = {}) {
  const { onProgress } = options;
  const entries = Object.entries(this.data).filter(([id]) => !!id);
  const total = entries.length;
  let processed = 0;
  const failures = [];

  for (const [id, note] of entries) {
    try {
      const wasEncrypted = isAppEncryptedContent(note.content);
      const decrypted = await decryptNoteForMemory(note);
      this.data[id] = hydrateNote(decrypted);

      if (wasEncrypted && isAppEncryptedContent(decrypted.content)) {
        failures.push(id);
        console.error(
          `[note] failed to decrypt app-encrypted note ${id} for migration`
        );
      }
    } catch (error) {
      failures.push(id);
      console.error(
        `[note] failed to normalize note ${id} before migration:`,
        error
      );
    } finally {
      processed += 1;
      onProgress?.({ phase: 'decrypt', processed, total, id });
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Failed to decrypt ${failures.length} note(s) for app-encryption migration.`
    );
  }
}

export async function persistAllNotesForAppEncryption(options = {}) {
  const { onProgress } = options;
  const entries = Object.entries(this.data).filter(([id]) => !!id);
  const total = entries.length;
  let processed = 0;
  const failures = [];

  for (const [id, note] of entries) {
    try {
      await saveNote(id, note);
    } catch (error) {
      failures.push(id);
      console.error(`[note] failed to encrypt note ${id}:`, error);
    } finally {
      processed += 1;
      onProgress?.({ phase: 'encrypt', processed, total, id });
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Failed to encrypt ${failures.length} note(s). Please retry after unlocking encryption key.`
    );
  }
}

export async function persistAllNotesPlaintext(options = {}) {
  const { onProgress } = options;
  const entries = Object.entries(this.data).filter(([id]) => !!id);
  const total = entries.length;
  let processed = 0;
  const failures = [];

  for (const [id, note] of entries) {
    try {
      await storage.set(`notes.${id}`, stripTransientFields(note));
    } catch (error) {
      failures.push(id);
      console.error(`[note] failed to persist plaintext note ${id}:`, error);
    } finally {
      processed += 1;
      onProgress?.({ phase: 'plaintext', processed, total, id });
    }
  }

  if (failures.length > 0) {
    throw new Error(`Failed to write ${failures.length} note(s) in plaintext.`);
  }
}
