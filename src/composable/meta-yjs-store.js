/**
 * Meta Yjs store hydration — pushes workspace-doc changes into
 * Pinia stores and backfills missing card previews.
 */

import * as Y from 'yjs';
import { getSnapshot } from '@/lib/native/yjs.js';
import { useStorage } from '@/composable/storage';
import { buildNotePreview } from '@/utils/note/cardPreview.js';
import { extractTextFromContent } from '@/utils/note/serializer.js';
import { isEncryptedContent } from '@/utils/crypto/encryption.js';
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap';
import { useFolderStore } from '@/store/folder';
import { useNoteStore } from '@/store/note';
import { useLabelStore } from '@/store/label';
import { saveNote } from '@/store/note/helpers';
import { yMapToObj } from '@/utils/yjs-helpers.js';
import { getWorkspaceDoc } from './meta-yjs-doc.js';

const storage = useStorage();

const EMPTY_CARD_PREVIEW = { text: '', blocks: [] };

/**
 * Push workspace-doc changes into the Pinia stores (one-way: doc -> store).
 * Idempotent — re-applying the same state is a no-op for consumers.
 *
 * On first run the Y.Doc may be empty while KV stores already contain data
 * (notes, labels, folders, etc.). This function detects that and seeds the
 * Y.Doc from the KV stores so the Y.Doc becomes the source of truth going
 * forward.
 */
export async function writeStoresFromWorkspace() {
  const doc = getWorkspaceDoc();
  const folderStore = useFolderStore();
  const labelStore = useLabelStore();
  const noteStore = useNoteStore();

  // ── Merge KV stores into the Y.Doc ─────────────────────────────────────
  const yLabels = doc.getArray('labels');
  const yLabelColors = doc.getMap('labelColors');
  const yFolders = doc.getMap('folders');
  const yNotes = doc.getMap('notes');

  // Full KV collections — used both for seeding and for reattaching content
  // (locked / app-encrypted notes keep ciphertext in KV).
  const kvNotes = await storage.get('notes', {});
  const kvLabels = await storage.get('labels', []);
  const kvColors = await storage.get('labelColors', {});
  const kvFolders = await storage.get('folders', {});

  // Merge KV data into the Y.Doc by adding any entry that is *missing* from
  // the doc. Unlike a one-time "seed if empty" guard, this is idempotent and
  // also covers the case where the legacy migration populates KV *after* the
  // doc was first seeded (e.g. initializeWorkspace ran at app start with a
  // partial KV, then the legacy import added the rest). Without this, the
  // newly-imported notes would never reach the doc and would be invisible.
  const missingNotes = Object.entries(kvNotes).filter(
    ([id]) => !yNotes.has(id)
  );
  if (missingNotes.length > 0) {
    doc.transact(() => {
      for (const [id, note] of missingNotes) {
        const yNote = new Y.Map();
        const { content: _c, ...meta } = note;
        for (const [k, v] of Object.entries(meta)) {
          yNote.set(k, v);
        }
        yNotes.set(id, yNote);
      }
    });
  }

  const missingLabels = kvLabels.filter(
    (name) => !yLabels.toArray().includes(name)
  );
  if (missingLabels.length > 0) {
    yLabels.push(missingLabels);
  }

  const missingColors = Object.entries(kvColors).filter(
    ([k]) => !yLabelColors.has(k)
  );
  if (missingColors.length > 0) {
    doc.transact(() => {
      for (const [k, v] of missingColors) {
        yLabelColors.set(k, v);
      }
    });
  }

  const missingFolders = Object.entries(kvFolders).filter(
    ([id]) => !yFolders.has(id)
  );
  if (missingFolders.length > 0) {
    doc.transact(() => {
      for (const [id, folder] of missingFolders) {
        const yFolder = new Y.Map();
        for (const [k, v] of Object.entries(folder)) {
          yFolder.set(k, v);
        }
        yFolders.set(id, yFolder);
      }
    });
  }

  // Folders
  const folders = {};
  for (const [id, yFolder] of yFolders.entries()) {
    folders[id] = yMapToObj(yFolder);
  }
  folderStore.data = folders;
  folderStore.deletedIds = yMapToObj(doc.getMap('deletedFolderIds'));
  folderStore._rebuildIndex();

  // Labels
  labelStore.data = yLabels.toArray();
  labelStore.colors = yMapToObj(yLabelColors);

  // Note metadata (preserve content kept in memory separately)
  const notes = { ...noteStore.data };
  for (const [id, yNote] of doc.getMap('notes').entries()) {
    const meta = yMapToObj(yNote);
    const existing = notes[id] || {};
    const merged = { ...existing, ...meta };
    const hidden = merged.isLocked || isEncryptedContent(merged.content);

    // Locked / app-encrypted notes (and any note whose content was kept in
    // the KV store rather than migrated into a per-note Yjs doc) store their
    // content in the KV `notes.<id>` row. Reattach it here instead of letting
    // it be dropped when the meta was seeded from the Y.Doc.
    if (kvNotes[id]?.content && !merged.content) {
      merged.content = kvNotes[id].content;
    }

    if (meta.preview && meta.preview.length > 0) merged.preview = meta.preview;

    // Preserve the structured (styled) card preview that was persisted with
    // the note; otherwise rebuild a RICH preview from the actual note content
    // (not the flat text). Migrated notes keep their content in the per-note
    // Yjs doc; notes whose content stayed in KV use `merged.content` (reattached
    // above). The flat `preview`/`searchText` is only a last-resort fallback.
    if (hidden) {
      merged.cardPreview = EMPTY_CARD_PREVIEW;
    } else if (existing.cardPreview) {
      merged.cardPreview = existing.cardPreview;
    } else {
      let previewContent = merged.content || existing.content;
      if (!previewContent) {
        try {
          const snapshot = await getSnapshot(id);
          if (snapshot && snapshot.length > 0) {
            const tmp = new Y.Doc();
            Y.applyUpdate(
              tmp,
              snapshot instanceof Uint8Array
                ? snapshot
                : new Uint8Array(snapshot)
            );
            previewContent = yXmlFragmentToProsemirrorJSON(
              tmp.getXmlFragment('content')
            );
          }
        } catch (err) {
          console.warn('[meta-yjs] preview load failed for', id, err);
        }
      }

      const { cardPreview, preview } = buildNotePreview({
        content: previewContent,
        preview: merged.preview || meta.preview || meta.searchText,
        searchText: merged.searchText || meta.searchText,
        hidden: false,
      });
      merged.cardPreview = cardPreview;
      if (!merged.preview) merged.preview = preview;
    }

    notes[id] = merged;
  }
  noteStore.data = notes;
  noteStore.deletedIds = yMapToObj(doc.getMap('deletedNoteIds'));
}

/**
 * One-time backfill: notes written before `cardPreview` was persisted (or
 * migrated notes whose content left KV) have no preview source in memory, so
 * their cards are blank on launch until re-saved. For each such note we load
 * its Yjs snapshot (O(1) via the Phase 0 snapshot store), rebuild the
 * structured `cardPreview` + flat `preview` from the content, and persist them.
 * Runs deferred (non-blocking) and only once per device.
 */
export async function backfillNotePreviews() {
  const noteStore = useNoteStore();
  for (const [id, note] of Object.entries(noteStore.data || {})) {
    if (!note || !id || note.isLocked) continue;
    if (note.cardPreview && note.cardPreview.blocks?.length) continue;
    if (isEncryptedContent(note.content)) continue;
    try {
      const snapshot = await getSnapshot(id);
      if (!snapshot || snapshot.length === 0) continue;
      const tmp = new Y.Doc();
      Y.applyUpdate(
        tmp,
        snapshot instanceof Uint8Array ? snapshot : new Uint8Array(snapshot)
      );
      const content = yXmlFragmentToProsemirrorJSON(
        tmp.getXmlFragment('content')
      );
      if (!content || !content.content?.length) continue;

      const previewText = extractTextFromContent(content);
      const { cardPreview, preview } = buildNotePreview({
        content,
        preview: previewText,
      });
      note.cardPreview = cardPreview;
      note.preview = preview;
      await saveNote(id, note);
      // Import syncNoteMeta lazily to avoid circular dep at module evaluation
      const { syncNoteMeta } = await import('./useWorkspaceYjs.js');
      syncNoteMeta(note);
    } catch (err) {
      console.warn('[meta-yjs] preview backfill failed for', id, err);
    }
  }
}
