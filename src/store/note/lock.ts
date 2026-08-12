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

export async function lockNote(this: NoteStoreLockThis, id: string, _password?: string): Promise<void> {
  if (!this.data[id] || this.data[id].isLocked) return;

  this.data[id] = hydrateNote({
    ...this.data[id],
    isLocked: true,
    updatedAt: Date.now(),
  });

  await saveNote(id, this.data[id]);
}

export async function unlockNote(this: NoteStoreLockThis, id: string, _password?: string): Promise<void> {
  if (!this.data[id] || !this.data[id].isLocked) return;

  this.data[id] = hydrateNote({
    ...this.data[id],
    isLocked: false,
    updatedAt: Date.now(),
  });

  await saveNote(id, this.data[id]);
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
