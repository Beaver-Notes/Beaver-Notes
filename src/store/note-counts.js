/**
 * Build a folderId -> note-count map in a single O(n) pass.
 *
 * Counts only notes with an id. Notes with a `null`/missing folderId are
 * treated as belonging to the root (key `null`), matching how the note store
 * treats them. Consumers that only care about real folders can ignore the
 * `null` key.
 */
export function buildFolderCounts(notes) {
  const counts = {};
  for (const note of notes) {
    if (!note?.id) continue;
    const key = note.folderId ?? null;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}
