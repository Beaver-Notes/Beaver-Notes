import { isEncryptedContent } from '@/utils/crypto/encryption.js';
import { hydrateNote, decryptNoteForMemory } from '@/utils/note/serializer.js';
import { saveNote } from './index';

export async function decryptAllNotesForAppEncryption(options = {}) {
  const { onProgress } = options;
  const entries = Object.entries(this.data).filter(([id]) => !!id);
  const total = entries.length;
  let processed = 0;
  const failures = [];

  for (const [id, note] of entries) {
    try {
      const wasEncrypted = isEncryptedContent(note.content);
      const decrypted = await decryptNoteForMemory(note);
      this.data[id] = hydrateNote(decrypted);

      if (wasEncrypted && isEncryptedContent(decrypted.content)) {
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
