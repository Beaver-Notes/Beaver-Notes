import { buildNotePreview, EMPTY_CARD_PREVIEW } from '@/utils/note/cardPreview.js';
import { isEncryptedContent } from '@/utils/crypto/encryption.js';

/**
 * Merge one note's Yjs meta into its existing in-memory record.
 *
 * Keeps the existing card preview (a rebuild is expensive), preserves the
 * structured preview logic (hidden notes -> EMPTY_CARD_PREVIEW, otherwise
 * keep the persisted cardPreview or rebuild from content), and reattaches KV
 * content for locked / app-encrypted notes whose content lives in KV.
 *
 * Returns `{ note, needsSnapshot }` where `needsSnapshot` is true when the
 * note has no content source in memory and therefore needs a Yjs snapshot
 * load to build its card preview.
 */
export function mergeNoteEntry(existing, meta, kvContent) {
  const merged = { ...existing, ...meta };
  const hidden = merged.isLocked || isEncryptedContent(merged.content);

  if (kvContent && !merged.content) {
    merged.content = kvContent;
  }

  if (meta.preview && meta.preview.length > 0) merged.preview = meta.preview;

  let needsSnapshot = false;
  if (hidden) {
    merged.cardPreview = EMPTY_CARD_PREVIEW;
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

/**
 * Decide whether the KV store must be read for a workspace change.
 *
 * KV reads are only needed to (a) seed entries that are missing from the
 * workspace doc, or (b) reattach content for locked / app-encrypted notes
 * whose content lives in KV. Once seeded, a change that only touches ordinary
 * notes (or folders/labels) can skip the reads entirely.
 *
 * `changedMetaById` maps changed note ids to their plain (already-converted)
 * workspace meta. Only those notes are inspected.
 */
export function shouldReadKv({
  kvSeeded,
  changedMetaById,
  storeData,
}) {
  if (!kvSeeded) return true;

  if (!changedMetaById || Object.keys(changedMetaById).length === 0) {
    // A non-note change (folder/label) after seeding needs no KV reads.
    return false;
  }

  for (const id of Object.keys(changedMetaById)) {
    const meta = changedMetaById[id];
    const inStore = storeData[id];
    const needsContent =
      (meta.isLocked || isEncryptedContent(meta.content)) &&
      !(inStore && inStore.content);
    if (needsContent) return true;
  }
  return false;
}
