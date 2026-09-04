/** Meta Yjs hydration: pushes workspace-doc changes into Pinia, backfills previews. */

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

// Lazy: @tiptap/y-tiptap pulls in prosemirror; don't load until a preview needs it.
let yXmlToJsonPromise = null;
async function yXmlFragmentToProsemirrorJSON(xmlFragment) {
  if (!yXmlToJsonPromise) {
    yXmlToJsonPromise = import('@tiptap/y-tiptap');
  }
  const mod = await yXmlToJsonPromise;
  return mod.yXmlFragmentToProsemirrorJSON(xmlFragment);
}

/** Batch-load note CONTENT as ProseMirror JSON from Yjs snapshots (only content store). Missing notes absent, caller falls back. */
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

/** Push workspace-doc changes into Pinia (one-way doc to store). Idempotent, Y.Doc is metadata truth, content lives per-note. */
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

  // Incremental batches rebuild only when flagged: avoids app-wide re-renders at scale. Initial rebuilds all.
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

  // Content lives in per-note Yjs docs; previews without an in-memory
  // content source are built from the note's snapshot (batched below).
  const pendingPreviews = [];

  if (changedIds) {
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

  // Batch-load snapshots for notes with no in-memory content source.
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
            // Persist the built preview so next launch skips content conversion.
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

/** Seed workspace Y.Doc from legacy data (no KV reads) in one seed transaction. Yjs delete plus doc wipe is tombstone. */
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

/** One-time backfill: rebuild missing cardPreview plus preview from Yjs snapshots. Deferred, non-blocking, once per device. */
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
