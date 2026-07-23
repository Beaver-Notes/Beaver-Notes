import { useAppStore } from '../app';
import {
  encryptNoteWithPassword,
  decryptNoteWithPassword,
  NOTE_CRYPTO_ERROR,
} from '@/utils/crypto/noteCrypto.js';
import { hydrateNote } from '@/utils/note/serializer.js';
import {
  reconcileFootnotes,
  uncollapseHeadings,
} from '@/utils/note/contentUtils.js';
import { saveNote } from './index';

interface NoteStoreLockThis {
  data: Record<string, any>;
  convertNote(id: string): void;
}

export async function lockNote(this: NoteStoreLockThis, id: string, password: string): Promise<void> {
  if (!password) {
    console.error('No password provided.');
    return;
  }

  try {
    if (this.data[id].isLocked) return;

    const encryptedContent = await encryptNoteWithPassword(
      JSON.stringify(this.data[id].content),
      password
    );

    this.data[id] = hydrateNote({
      ...this.data[id],
      content: { type: 'doc', content: [encryptedContent] },
      isLocked: true,
      updatedAt: Date.now(),
    });

    await saveNote(id, this.data[id]);
  } catch (error) {
    console.error('Error locking note:', error);
    throw error;
  }
}

export async function unlockNote(this: NoteStoreLockThis, id: string, password: string): Promise<void> {
  if (!password) {
    console.error('No password provided.');
    return;
  }

  try {
    const note = this.data[id];
    if (!note) {
      console.error('Note not found.');
      return;
    }
    if (!note.isLocked) return;

    const isEncrypted =
      typeof note.content.content[0] === 'string' &&
      note.content.content[0].trim().length > 0;

    if (!isEncrypted) {
      this.data[id] = hydrateNote({
        ...this.data[id],
        isLocked: false,
        updatedAt: Date.now(),
      });
      await saveNote(id, this.data[id]);
      return;
    }

    let decryptedContent: string, wasLegacy: boolean | undefined;
    try {
      ({ plaintext: decryptedContent, wasLegacy } =
        await decryptNoteWithPassword(
          this.data[id].content.content[0],
          password
        ));
    } catch {
      throw new Error(NOTE_CRYPTO_ERROR);
    }

    this.data[id].content = JSON.parse(decryptedContent);

    // Migrate legacy v1 ciphertext to v2 silently
    if (wasLegacy) {
      try {
        const v2cipher = await encryptNoteWithPassword(
          decryptedContent,
          password
        );
        await saveNote(id, {
          ...this.data[id],
          content: { type: 'doc', content: [v2cipher] },
          isLocked: true,
        });
      } catch (migErr) {
        console.warn('[note] v1→v2 migration failed (non-fatal):', migErr);
      }
    }

    const appStore = useAppStore();
    if (!appStore.setting.collapsibleHeading) {
      this.convertNote(id);
    }

    this.data[id] = hydrateNote({
      ...this.data[id],
      isLocked: false,
      updatedAt: Date.now(),
    });

    await saveNote(id, this.data[id]);
  } catch (error) {
    console.error('Error unlocking note:', error);
    throw error;
  }
}

export function convertNote(this: NoteStoreLockThis, id: string): void {
  const note = this.data[id];
  if (!note || note.isLocked) return;
  const content = note.content;
  if (!content || typeof content === 'string' || !Array.isArray(content.content)) {
    return;
  }
  const footnotes: any[] = [];
  const newContent = uncollapseHeadings(content.content, footnotes);
  note.content = { ...content, content: newContent };
  if (footnotes.length > 0) {
    reconcileFootnotes(note, footnotes);
  }
  this.data[id] = hydrateNote({ ...note });
}

// Kept for backward-compatibility with any callers that reference the store method directly.
export function uncollapseHeading(contents: any[], footnotes: any[]): any[] {
  return uncollapseHeadings(contents, footnotes);
}

// Legacy migration — no longer needed; lock state lives in Yjs note metadata.
export async function migrateLockData(): Promise<void> {
  // no-op
}
