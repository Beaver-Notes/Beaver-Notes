import { path } from '@/lib/tauri-bridge';
import { removePath } from '@/lib/native/fs';

/**
 * Append a finished recording into a note not currently open in the editor.
 * The file already lives in the note's assets dir (the recorder writes there);
 * this only inserts the audio node at the saved cursor (or the end), mirrors
 * into the Yjs doc, and persists.
 *
 * @param {string} noteId
 * @param {string} filePath Absolute path of the recorded file.
 * @param {import('@/store/note').useNoteStore} noteStore
 * @param {number} [cursorPos] Saved ProseMirror position at recording start.
 */
export async function insertAudioIntoClosedNote(
  noteId,
  filePath,
  noteStore,
  cursorPos = null
) {
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
  const insertIndex =
    cursorPos == null ? children.length : posToContentIndex(note.content, cursorPos);
  const content = {
    type: 'doc',
    content: [
      ...children.slice(0, insertIndex),
      audioNode,
      ...children.slice(insertIndex),
    ],
  };

  noteStore.patchLocal(noteId, { content, updatedAt: Date.now() });

  // Replace (compact) rather than append: appending an independent full-state
  // update to a note that already has Yjs content duplicates the whole note.
  const { replaceNoteContentInYjs } = await import(
    '@/utils/note/contentToYjs.js'
  );
  await replaceNoteContentInYjs(noteId, content);
  await noteStore.persist(noteId);
}

/**
 * Best-effort mapping of a saved ProseMirror cursor onto the note's top-level
 * content array (+1 per block boundary; exact PM offset math not required).
 *
 * @param {{ content?: unknown[] }} content
 * @param {number} cursorPos
 * @returns {number} Index in `content.content` where the audio node goes.
 */
export function posToContentIndex(content, cursorPos) {
  const blocks = Array.isArray(content?.content) ? content.content : [];
  if (!Number.isFinite(cursorPos) || cursorPos < 0 || blocks.length === 0) {
    return blocks.length;
  }

  let start = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (cursorPos <= start) return i;
    start += blockTextLength(blocks[i]) + 1;
  }
  return blocks.length;
}

/**
 * Best-effort block size: text length, +1 constant for leaf nodes with no text.
 *
 * @param {unknown} node
 * @returns {number}
 */
function blockTextLength(node) {
  if (!node) return 0;
  if (node.type === 'text') return node.text?.length ?? 0;
  const children = Array.isArray(node.content) ? node.content : [];
  if (children.length === 0) return 1;
  let size = 0;
  for (const child of children) size += blockTextLength(child);
  return size;
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
    // File may be gone: nothing to clean.
  }
}
