import { useAppStore } from '../app';
import {
  encryptNoteWithPassword,
  decryptNoteWithPassword,
} from '@/utils/noteCrypto.js';
import { hydrateNote } from '@/utils/noteSerializer.js';
import {
  reconcileFootnotes,
  uncollapseHeadings,
} from '@/utils/noteContentUtils.js';
import { saveNote, trackNoteChange, storage } from './helpers';

export async function lockNote(id, password) {
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
    await trackNoteChange(id, this.data[id]);
  } catch (error) {
    console.error('Error locking note:', error);
    throw error;
  }
}

export async function unlockNote(id, password) {
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
      await trackNoteChange(id, this.data[id]);
      return;
    }

    let decryptedContent, wasLegacy;
    try {
      ({ plaintext: decryptedContent, wasLegacy } =
        await decryptNoteWithPassword(
          this.data[id].content.content[0],
          password
        ));
    } catch {
      throw new Error('Incorrect password');
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
    await trackNoteChange(id, this.data[id]);
  } catch (error) {
    console.error('Error unlocking note:', error);
    throw error;
  }
}

export function convertNote(id) {
  const note = this.data[id];
  const footnotes = [];
  note.content.content = uncollapseHeadings(
    note.content.content ?? [],
    footnotes
  );
  if (footnotes.length > 0) {
    reconcileFootnotes(note, footnotes);
  }
  this.data[id] = hydrateNote(note);
}

// Kept for backward-compatibility with any callers that reference the store method directly.
export function uncollapseHeading(contents, footnotes) {
  return uncollapseHeadings(contents, footnotes);
}

export async function migrateLockData() {
  const lockStatusData = await storage.get('lockStatus', {});
  const isLockedData = await storage.get('isLocked', {});

  const hasLegacyData =
    Object.keys(lockStatusData).length > 0 ||
    Object.keys(isLockedData).length > 0;

  if (!hasLegacyData) return;

  let hasChanges = false;

  for (const noteId in this.data) {
    const wasLocked =
      lockStatusData[noteId] === 'locked' || isLockedData[noteId] === true;

    if (wasLocked && !this.data[noteId].isLocked) {
      this.data[noteId] = hydrateNote({ ...this.data[noteId], isLocked: true });
      hasChanges = true;
    }
  }

  if (hasChanges) {
    for (const noteId in this.data) {
      await saveNote(noteId, this.data[noteId]);
    }
    await this.retrieve();
  }

  await storage.delete('lockStatus');
  await storage.delete('isLocked');
}
