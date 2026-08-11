/**
 * Meta Yjs store hydration — pushes workspace-doc changes into
 * Pinia stores and backfills missing card previews.
 */

import * as Y from 'yjs';
import { getSnapshots } from '@/lib/native/yjs.js';
import { useStorage } from '@/composable/storage';
import { buildNotePreview } from '@/utils/note/cardPreview.js';
import { isEncryptedContent } from '@/utils/crypto/encryption.js';
import { useFolderStore } from '@/store/folder';
import { useNoteStore } from '@/store/note';
import { useLabelStore } from '@/store/label';
import { saveNote } from '@/store/note/index';
import { yMapToObj, toUint8Array } from '@/utils/yjs-helpers.js';
import { getWorkspaceDoc } from './meta-yjs-doc.js';
import {
  mergeNoteEntry,
  diffRemovedNoteIds,
  shouldReadKv,
} from './meta-yjs-merge.js';

const storage = useStorage();

function buildNotePreviewFromContent(merged, content) {
  return buildNotePreview({
    content,
    preview: merged.preview || merged.searchText,
    searchText: merged.searchText,
    hidden: false,
  });
}

// Lazy wrapper — @tiptap/y-tiptap pulls in prosemirror, which should not load
// until a note actually needs a snapshot-based preview.
let yXmlToJsonPromise = null;
async function yXmlFragmentToProsemirrorJSON(xmlFragment) {
  if (!yXmlToJsonPromise) {
    yXmlToJsonPromise = import('@tiptap/y-tiptap');
  }
  const mod = await yXmlToJsonPromise;
  return mod.yXmlFragmentToProsemirrorJSON(xmlFragment);
}

// Once all KV entries have been merged into the workspace doc, subsequent
// workspace changes can skip the KV reads entirely unless a locked /
// encrypted note needs content reattached.
let kvSeeded = false;

/**
 * Push workspace-doc changes into the Pinia stores (one-way: doc -> store).
 * Idempotent — re-applying the same state is a no-op for consumers.
 *
 * On first run the Y.Doc may be empty while KV stores already contain data
 * (notes, labels, folders, etc.). This function detects that and seeds the
 * Y.Doc from the KV stores so the Y.Doc becomes the source of truth going
 * forward.
 *
 * @param {Set<string>|undefined} [changedNoteIds] ids of notes whose meta
 *   changed in this batch. When provided, only those notes are re-merged and
 *   removed ids are evicted — the store map is not rebuilt wholesale. When
 *   omitted, all notes are re-merged (initial hydration).
 */
export async function writeStoresFromWorkspace(changedNoteIds) {
  const doc = getWorkspaceDoc();
  const folderStore = useFolderStore();
  const labelStore = useLabelStore();
  const noteStore = useNoteStore();

  // ── Merge KV stores into the Y.Doc ─────────────────────────────────────
  const yLabels = doc.getArray('labels');
  const yLabelColors = doc.getMap('labelColors');
  const yFolders = doc.getMap('folders');
  const yNotes = doc.getMap('notes');

  // Read KV only while seeding is incomplete or a changed note may need its
  // content reattached (locked / app-encrypted notes keep content in KV).
  const changedIds = changedNoteIds instanceof Set ? changedNoteIds : null;
  const changedMetaById = {};
  if (changedIds) {
    for (const id of changedIds) {
      const yNote = yNotes.get(id);
      if (yNote) changedMetaById[id] = yMapToObj(yNote);
    }
  }

  let kvNotes = {};
  let kvLabels = [];
  let kvColors = {};
  let kvFolders = {};
  if (shouldReadKv({ kvSeeded, changedMetaById, storeData: noteStore.data })) {
    // Full KV collections — used both for seeding and for reattaching content
    // (locked / app-encrypted notes keep ciphertext in KV).
    kvNotes = await storage.get('notes', {});
    kvLabels = await storage.get('labels', []);
    kvColors = await storage.get('labelColors', {});
    kvFolders = await storage.get('folders', {});

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
      }, 'seed');
    }

    const missingLabels = kvLabels.filter(
      (name) => !yLabels.toArray().includes(name)
    );

    // Deduplicate the Y.Array if duplicates somehow accumulated
    const seen = new Set();
    const deduped = [];
    for (let i = 0; i < yLabels.length; i++) {
      const name = yLabels.get(i);
      if (!seen.has(name)) {
        seen.add(name);
        deduped.push(name);
      }
    }

    doc.transact(() => {
      if (missingLabels.length > 0) {
        yLabels.push(missingLabels);
      }
      if (deduped.length !== yLabels.length) {
        yLabels.delete(0, yLabels.length);
        yLabels.push(deduped);
      }
    }, 'seed');

    const missingColors = Object.entries(kvColors).filter(
      ([k]) => !yLabelColors.has(k)
    );
    if (missingColors.length > 0) {
      doc.transact(() => {
        for (const [k, v] of missingColors) {
          yLabelColors.set(k, v);
        }
      }, 'seed');
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
      }, 'seed');
    }

    // Seeding is complete once nothing is missing from the doc.
    const stillMissing =
      Object.entries(kvNotes).some(([id]) => !yNotes.has(id)) ||
      kvLabels.some((name) => !yLabels.toArray().includes(name)) ||
      Object.entries(kvColors).some(([k]) => !yLabelColors.has(k)) ||
      Object.entries(kvFolders).some(([id]) => !yFolders.has(id));
    if (!stillMissing) kvSeeded = true;
  }

  // ── Folders (cheap, always rebuilt) ────────────────────────────────────
  const folders = {};
  for (const [id, yFolder] of yFolders.entries()) {
    folders[id] = yMapToObj(yFolder);
  }
  folderStore.data = folders;
  folderStore.deletedIds = yMapToObj(doc.getMap('deletedFolderIds'));
  folderStore._rebuildIndex();

  // ── Labels (cheap, always rebuilt) ─────────────────────────────────────
  labelStore.data = [...new Set(yLabels.toArray())];
  labelStore.colors = yMapToObj(yLabelColors);

  // ── Note metadata (preserve content kept in memory separately) ────────
  const pendingPreviews = [];

  if (changedIds) {
    // Incremental: re-merge only the changed notes and evict removed ones.
    for (const id of changedIds) {
      const yNote = yNotes.get(id);
      if (!yNote) continue;
      const meta = yMapToObj(yNote);
      const existing = noteStore.data[id] || {};
      const { note: merged, needsSnapshot } = mergeNoteEntry(
        existing,
        meta,
        kvNotes[id]?.content
      );
      if (needsSnapshot) pendingPreviews.push(id);
      noteStore.data[id] = merged;
    }

    const removed = diffRemovedNoteIds(
      Object.keys(noteStore.data),
      new Set(yNotes.keys())
    );
    for (const id of removed) {
      delete noteStore.data[id];
    }
  } else {
    // Full hydration: merge every note in the doc.
    for (const [id, yNote] of yNotes.entries()) {
      const meta = yMapToObj(yNote);
      const existing = noteStore.data[id] || {};
      const { note: merged, needsSnapshot } = mergeNoteEntry(
        existing,
        meta,
        kvNotes[id]?.content
      );
      if (needsSnapshot) pendingPreviews.push(id);
      noteStore.data[id] = merged;
    }

    const removed = diffRemovedNoteIds(
      Object.keys(noteStore.data),
      new Set(yNotes.keys())
    );
    for (const id of removed) {
      delete noteStore.data[id];
    }
  }

  // Batch-load Yjs snapshots for notes that have no in-memory content source
  // (single round-trip instead of one IPC call per note).
  if (pendingPreviews.length > 0) {
    try {
      const snapshots = await getSnapshots(pendingPreviews);
      for (const id of pendingPreviews) {
        const snapshot = snapshots?.[id];
        if (!snapshot || snapshot.length === 0) continue;
        const tmp = new Y.Doc();
        Y.applyUpdate(tmp, toUint8Array(snapshot));
        const content = await yXmlFragmentToProsemirrorJSON(
          tmp.getXmlFragment('content')
        );
        const merged = noteStore.data[id];
        if (!merged) continue;
        const { cardPreview, preview } = buildNotePreviewFromContent(merged, content);
        merged.cardPreview = cardPreview;
        if (!merged.preview) merged.preview = preview;
      }
    } catch (err) {
      console.warn('[meta-yjs] batch preview load failed', err);
    }
  }
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
  const needsSnapshot = [];
  for (const [id, note] of Object.entries(noteStore.data || {})) {
    if (!note || !id || note.isLocked) continue;
    if (note.cardPreview && note.cardPreview.blocks?.length) continue;
    if (isEncryptedContent(note.content)) continue;
    needsSnapshot.push(id);
  }
  if (needsSnapshot.length === 0) return;

  let snapshots = {};
  try {
    // Batch-load all missing previews in a single round-trip.
    snapshots = await getSnapshots(needsSnapshot);
  } catch (err) {
    console.warn('[meta-yjs] preview backfill batch failed', err);
    return;
  }

  for (const [id, snapshot] of Object.entries(snapshots)) {
    const note = noteStore.data[id];
    if (!note || !snapshot || snapshot.length === 0) continue;
    try {
      const tmp = new Y.Doc();
      Y.applyUpdate(tmp, toUint8Array(snapshot));
      const content = await yXmlFragmentToProsemirrorJSON(
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
