import { path } from '@/lib/tauri-bridge';
import { removePath } from '@/lib/native/fs';

/**
 * Append a finished recording into a note that is not currently open in the
 * editor. The recording file already lives in the note's assets directory
 * (the recorder writes there), so this only records the node in the note's
 * content JSON, mirrors it into the note's Yjs doc, and persists.
 *
 * Best-effort position mapping: we always append to the end of the note.
 *
 * @param {string} noteId
 * @param {string} filePath Absolute path of the recorded file.
 * @param {import('@/store/note').useNoteStore} noteStore
 */
export async function insertAudioIntoClosedNote(noteId, filePath, noteStore) {
  if (!noteId || !filePath) return;

  const note = noteStore.getById(noteId);
  if (!note) {
    await cleanupOrphanAudio(filePath);
    return;
  }

  const filename = path.basename(filePath);
  const src = `assets://${noteId}/${filename}`;
  const audioNode = {
    type: 'Audio',
    attrs: { src, fileName: filename },
  };
  const children = Array.isArray(note.content?.content)
    ? note.content.content
    : [];
  const content = { type: 'doc', content: [...children, audioNode] };

  noteStore.patchLocal(noteId, { content, updatedAt: Date.now() });

  const { writeNoteContentToYjs } = await import(
    '@/utils/note/contentToYjs.js'
  );
  await writeNoteContentToYjs(noteId, content);
  await noteStore.persist(noteId);
}

/**
 * Remove an orphaned recording file (e.g. the target note was deleted
 * mid-recording). Best-effort; never throws.
 */
export async function cleanupOrphanAudio(filePath) {
  if (!filePath) return;
  try {
    await removePath(filePath);
  } catch {
    // File may already be gone — nothing to clean up.
  }
}
