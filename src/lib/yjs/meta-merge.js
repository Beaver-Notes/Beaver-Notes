import { buildNotePreview, EMPTY_CARD_PREVIEW } from '@/utils/note/cardPreview.js';

/** Merge Yjs meta into record, keep existing preview (rebuilds expensive). needsSnapshot means load snapshot for missing preview. */
export function mergeNoteEntry(existing, meta) {
  const merged = { ...existing, ...meta };

  if (meta.preview && meta.preview.length > 0) merged.preview = meta.preview;

  let needsSnapshot = false;
  if (merged.isLocked) {
    merged.cardPreview = EMPTY_CARD_PREVIEW;
  } else if (meta.cardPreview && meta.cardPreview.blocks) {
    // Persisted preview: no content load or conversion (launch speed).
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

/** Notes in store missing from doc (deleted), so caller evicts exactly those. */
export function diffRemovedNoteIds(storeIds, docIds) {
  const removed = [];
  for (const id of storeIds) {
    if (!docIds.has(id)) removed.push(id);
  }
  return removed;
}
