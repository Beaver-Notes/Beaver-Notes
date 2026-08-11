import { isEncryptedContent } from '@/utils/crypto/encryption.js';
import { batchDecryptNotesForMemory } from '@/utils/note/serializer.js';
import { saveNote } from './index';

interface EncryptionProgress {
  phase: 'decrypt' | 'encrypt';
  processed: number;
  total: number;
  id: string;
}

interface NoteStoreEncryptionThis {
  data: Record<string, any>;
}

export async function decryptAllNotesForAppEncryption(
  this: NoteStoreEncryptionThis,
  options: { onProgress?: (progress: EncryptionProgress) => void } = {}
): Promise<void> {
  const { onProgress } = options;
  const entries = Object.entries(this.data).filter(([id]) => !!id);
  const total = entries.length;
  const failures: string[] = [];

  if (total === 0) return;

  const notes = entries.map(([id, note]) => ({ ...note, id }));
  const decryptedNotes = await batchDecryptNotesForMemory(notes, {
    onProgress: (progress: { processed: number; total: number; id: string }) => {
      onProgress?.({
        phase: 'decrypt',
        processed: progress.processed,
        total: progress.total,
        id: progress.id,
      });
    },
  });

  for (let i = 0; i < entries.length; i++) {
    const [id] = entries[i];
    const decrypted = decryptedNotes[i];
    this.data[id] = decrypted;

    if (isEncryptedContent(decrypted.content)) {
      failures.push(id);
      console.error(
        `[note] failed to decrypt app-encrypted note ${id} for migration`
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Failed to decrypt ${failures.length} note(s) for app-encryption migration.`
    );
  }
}

export async function persistAllNotesForAppEncryption(
  this: NoteStoreEncryptionThis,
  options: { onProgress?: (progress: EncryptionProgress) => void } = {}
): Promise<void> {
  const { onProgress } = options;
  const entries = Object.entries(this.data).filter(([id]) => !!id);
  const total = entries.length;
  let processed = 0;
  const failures: string[] = [];

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
