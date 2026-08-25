/**
 * Meta Yjs store hydration — pushes workspace-doc changes into
 * Pinia stores and backfills missing card previews.
 */

import * as Y from 'yjs';
import { getSnapshots } from '@/lib/native/yjs.js';
import { buildNotePreview } from '@/utils/note/cardPreview.js';
import { isEncryptedContent } from '@/utils/crypto/encryption.js';
import { extractTextFromContent } from '@/utils/note/serializer.js';
import { useFolderStore } from '@/store/folder';
import { useNoteStore } from '@/store/note';
import { useLabelStore } from '@/store/label';
import { saveNote } from '@/store/note/index';
import { yMapToObj, toUint8Array } from '@/lib/yjs/helpers.js';
import { getWorkspaceDoc } from './meta-doc.js';
import {
  mergeNoteEntry,
  diffRemovedNoteIds,
} from './meta-merge.js';

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

/**
 * Batch-load note CONTENT as ProseMirror JSON from per-note Yjs snapshots
 * (the only place content lives post-migration). Missing/locked/failed notes
 * are simply absent from the result so callers can fall back to whatever
 * in-memory copy they have.
 *
 * @param {string[]} noteIds
 * @returns {Promise<Record<string, object>>} id -> ProseMirror JSON doc
 */
export async function readNoteContents(noteIds) {
  const contents = {};
  if (!Array.isArray(noteIds) || noteIds.length === 0) return contents;
  let snapshots;
  try {
    snapshots = await getSnapshots(noteIds);
  } catch (err) {
    console.warn('[meta-yjs] snapshot batch failed', err);
    return contents;
  }
  for (const id of noteIds) {
    const snapshot = snapshots?.[id];
    if (!snapshot || snapshot.length === 0) continue;
    const tmp = new Y.Doc();
    try {
      Y.applyUpdate(tmp, toUint8Array(snapshot));
      contents[id] = await yXmlFragmentToProsemirrorJSON(
        tmp.getXmlFragment('content')
      );
    } catch (err) {
      console.warn('[meta-yjs] content load failed for', id, err);
    } finally {
      tmp.destroy();
    }
  }
  return contents;
}

/**
 * Push workspace-doc changes into the Pinia stores (one-way: doc -> store).
 * Idempotent — re-applying the same state is a no-op for consumers.
 *
 * The workspace Y.Doc is the single source of truth for metadata; note CONTENT
 * lives in per-note Yjs docs. No KV reads, no seeding, no conversion.
 *
 * @param {Set<string>|undefined} [changedNoteIds] ids of notes whose meta
 *   changed in this batch. When provided, only those notes are re-merged and
 *   removed ids are evicted — the store map is not rebuilt wholesale. When
 *   omitted, all notes are re-merged (initial hydration).
 * @param {{folders?: boolean, labels?: boolean, labelColors?: boolean}|undefined} [metaChanges]
 *   flags for which non-note collections changed in this batch (from
 *   `observeWorkspace`). When provided, folders/labels are only rebuilt when
 *   their flag is set; when omitted (initial hydration) everything is rebuilt.
 */
export async function writeStoresFromWorkspace(changedNoteIds, metaChanges) {
  const doc = getWorkspaceDoc();
  const folderStore = useFolderStore();
  const labelStore = useLabelStore();
  const noteStore = useNoteStore();

  const yLabels = doc.getArray('labels');
  const yLabelColors = doc.getMap('labelColors');
  const yFolders = doc.getMap('folders');
  const yNotes = doc.getMap('notes');

  const changedIds = changedNoteIds instanceof Set ? changedNoteIds : null;

  const isInitialHydration = !metaChanges;
  let foldersNeedRebuild = isInitialHydration || metaChanges.folders;
  let labelsNeedRebuild = isInitialHydration || metaChanges.labels || metaChanges.labelColors;

  // ── Folders / Labels ───────────────────────────────────────────────────────
  // Incremental batches only rebuild a collection when its own flag is set.
  // Note-only changes previously rebuilt every folder/label object and
  // cascaded a full reactive re-render of every folder-dependent computed
  // app-wide — the dominant cost for a single-note edit at scale. Initial
  // hydration (no flags) rebuilds everything.
  if (foldersNeedRebuild) {
    const folders = {};
    for (const [id, yFolder] of yFolders.entries()) {
      folders[id] = yMapToObj(yFolder);
    }
    folderStore.data = folders;
    folderStore._rebuildIndex();
  }

  if (labelsNeedRebuild) {
    labelStore.data = [...new Set(yLabels.toArray())];
    labelStore.colors = yMapToObj(yLabelColors);
  }

  // ── Note metadata ──────────────────────────────────────────────────────────
  // Content lives in per-note Yjs docs. Card previews missing an in-memory
  // content source are built from the note's Yjs snapshot (batched below).
  const pendingPreviews = [];

  if (changedIds) {
    // Incremental: re-merge only the changed notes and evict removed ones.
    for (const id of changedIds) {
      const yNote = yNotes.get(id);
      if (!yNote) continue;
      const meta = yMapToObj(yNote);
      const existing = noteStore.data[id] || {};
      const { note: merged, needsSnapshot } = mergeNoteEntry(existing, meta);
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
      const { note: merged, needsSnapshot } = mergeNoteEntry(existing, meta);
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
    let snapshots;
    try {
      snapshots = await getSnapshots(pendingPreviews);
    } catch (err) {
      console.warn('[meta-yjs] batch preview load failed', err);
    }
    if (snapshots) {
      let syncNoteMeta;
      try {
        ({ syncNoteMeta } = await import('./workspace-doc.js'));
      } catch (err) {
        console.warn('[meta-yjs] batch preview load failed', err);
      }
      if (syncNoteMeta) {
        for (const id of pendingPreviews) {
          const snapshot = snapshots?.[id];
          if (!snapshot || snapshot.length === 0) continue;
          const tmp = new Y.Doc();
          try {
            Y.applyUpdate(tmp, toUint8Array(snapshot));
            const content = await yXmlFragmentToProsemirrorJSON(
              tmp.getXmlFragment('content')
            );
            const merged = noteStore.data[id];
            if (!merged) continue;
            const { cardPreview, preview } = buildNotePreviewFromContent(merged, content);
            merged.cardPreview = cardPreview;
            if (!merged.preview) merged.preview = preview;
            // Persist the built preview so the next launch reads it from the
            // workspace doc instead of loading + converting the content again.
            syncNoteMeta(merged);
          } catch (err) {
            console.warn('[meta-yjs] preview load failed for', id, err);
          } finally {
            tmp.destroy();
          }
        }
      }
    }
  }
}

/**
 * Import-time: seed the workspace Y.Doc directly from parsed legacy data
 * (no KV reads). Writes note meta, folders, the labels array and label colors
 * in a single `'seed'` transaction. Deleted-id tombstones are no longer used
 * — deletion is the Yjs map delete + per-note doc wipe (yjs_delete).
 *
 * @param {Record<string, object>} notes  id -> note meta (content excluded)
 * @param {Record<string, object>} folders id -> folder
 * @param {string[]} labels
 * @param {Record<string, string>} labelColors
 * @param {Record<string, number>} [deletedIds] ignored, kept for compat
 * @param {Record<string, number>} [deletedFolderIds] ignored, kept for compat
 */
export async function seedWorkspaceDocFromData(
  notes,
  folders,
  labels,
  labelColors,
  deletedIds,
  deletedFolderIds
) {
  const doc = getWorkspaceDoc();
  const yNotes = doc.getMap('notes');
  const yFolders = doc.getMap('folders');
  const yLabels = doc.getArray('labels');
  const yLabelColors = doc.getMap('labelColors');

  const SEED_META_FIELDS = [
    'id',
    'title',
    'folderId',
    'labels',
    'isArchived',
    'isLocked',
    'isBookmarked',
    'isFullWidth',
    'createdAt',
    'updatedAt',
    'cardPreview',
    'preview',
    'searchText',
  ];

  let seededNotes = 0;
  let seededFolders = 0;
  let seededLabels = 0;

  doc.transact(() => {
    for (const [id, note] of Object.entries(notes || {})) {
      const yNote = new Y.Map();
      for (const field of SEED_META_FIELDS) {
        if (note[field] !== undefined) yNote.set(field, note[field]);
      }
      yNotes.set(id, yNote);
      seededNotes++;
    }
    for (const [id, folder] of Object.entries(folders || {})) {
      if (yFolders.has(id)) continue;
      const yFolder = new Y.Map();
      for (const [k, v] of Object.entries(folder)) yFolder.set(k, v);
      yFolders.set(id, yFolder);
      seededFolders++;
    }
    for (const name of labels || []) {
      if (!yLabels.toArray().includes(name)) {
        yLabels.push([name]);
        seededLabels++;
      }
    }
    for (const [k, v] of Object.entries(labelColors || {})) {
      if (!yLabelColors.has(k)) yLabelColors.set(k, v);
    }
    void deletedIds;
    void deletedFolderIds;
  }, 'seed');

  return { seededNotes, seededFolders, seededLabels };
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

  let syncNoteMeta;
  try {
    ({ syncNoteMeta } = await import('./workspace-doc.js'));
  } catch (e) {
    console.warn('[meta-yjs] workspace-doc import failed', e);
    return;
  }
  for (const [id, snapshot] of Object.entries(snapshots)) {
    const note = noteStore.data[id];
    if (!note || !snapshot || snapshot.length === 0) continue;
    const tmp = new Y.Doc();
    try {
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
      syncNoteMeta(note);
    } catch (err) {
      console.warn('[meta-yjs] preview backfill failed for', id, err);
    } finally {
      tmp.destroy();
    }
  }
}
