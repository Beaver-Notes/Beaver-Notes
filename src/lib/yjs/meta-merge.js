import { buildNotePreview, EMPTY_CARD_PREVIEW } from '@/utils/note/cardPreview.js';

/**
 * Merge one note's Yjs meta into its existing in-memory record.
 *
 * Keeps the existing card preview (a rebuild is expensive). Note CONTENT lives
 * in the note's Yjs doc, never in the workspace meta — so when there's no
 * in-memory content source, the caller must load the Yjs snapshot to build the
 * preview (`needsSnapshot`).
 *
 * Returns `{ note, needsSnapshot }` where `needsSnapshot` is true when the
 * note has no content source in memory and therefore needs a Yjs snapshot
 * load to build its card preview.
 */
export function mergeNoteEntry(existing, meta) {
  const merged = { ...existing, ...meta };

  if (meta.preview && meta.preview.length > 0) merged.preview = meta.preview;

  let needsSnapshot = false;
  if (merged.isLocked) {
    merged.cardPreview = EMPTY_CARD_PREVIEW;
  } else if (meta.cardPreview && meta.cardPreview.blocks) {
    // Preview is persisted in the workspace doc — no content load, no
    // ProseMirror conversion. This is what keeps launch fast.
    merged.cardPreview = meta.cardPreview;
  } else if (existing.cardPreview) {
    merged.cardPreview = existing.cardPreview;
  } else {
    const previewContent = merged.content || existing.content;
    if (!previewContent) needsSnapshot = true;
    const { cardPreview, preview } = buildNotePreview({
      content: previewContent,
      preview: merged.preview || meta.preview || meta.searchText,
      searchText: merged.searchText || meta.searchText,
      hidden: false,
    });
    merged.cardPreview = cardPreview;
    if (!merged.preview) merged.preview = preview;
  }

  return { note: merged, needsSnapshot };
}

/**
 * Compute which notes are in the store but no longer present in the workspace
 * doc (deleted), so the caller can evict exactly those entries instead of
 * swapping the whole map.
 */
export function diffRemovedNoteIds(storeIds, docIds) {
  const removed = [];
  for (const id of storeIds) {
    if (!docIds.has(id)) removed.push(id);
  }
  return removed;
}
