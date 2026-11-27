/** Meta Yjs hydration: pushes workspace-doc changes into Pinia, backfills previews. */

import * as Y from 'yjs';
import { getSnapshots, appendBatch } from '@/lib/native/yjs.js';
import { buildNotePreview } from '@/utils/note/cardPreview.js';
import { isEncryptedContent } from '@/utils/crypto/encryption.js';
import { extractTextFromContent } from '@/utils/note/serializer.js';
import { useFolderStore } from '@/store/folder';
import { useNoteStore } from '@/store/note';
import { useLabelStore } from '@/store/label';
import { saveNote, syncSearchIndex, isSearchIndexCurrent } from '@/store/note/index';
import { yMapToObj, toUint8Array, getDeviceId } from '@/lib/yjs/helpers.js';
import { getWorkspaceDoc } from './meta-doc.js';
import { registerWsKeyForNotes } from '@/utils/sync/shared-keys.js';
import { getCachedWorkspaceKey } from '@/lib/api/workspaces';
import { useWorkspaceStore } from '@/store/workspace';
import { mergeNoteEntry, diffRemovedNoteIds } from './meta-merge.js';
import { isPendingNoteMeta } from './shared.js';

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
        tmp.getXmlFragment('content'),
      );
    } catch (err) {
      console.warn('[meta-yjs] content load failed for', id, err);
    } finally {
      tmp.destroy();
    }
  }
  return contents;
}

/** Evict store notes absent from the doc, except those whose meta write is
 * still in flight (store.add): the note exists in Pinia before its Yjs meta. */
function evictRemovedNotes(noteStore, docIds) {
  const removed = diffRemovedNoteIds(Object.keys(noteStore.data), docIds);
  for (const id of removed) {
    if (isPendingNoteMeta(id)) continue;
    delete noteStore.data[id];
  }
  // Evictions change folder counts (notes disappeared); caller rebuilds when >0.
  return removed.length;
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

  // Peers' note docs are sealed with this workspace's key, but the pull only
  // learns the ids from this map. Register the key again on every projection:
  // on a fresh device the workspace key arrives before the note list, so the
  // one-shot registration at init sees no ids and their rows stay unreadable.
  try {
    const wsId = useWorkspaceStore().activeId;
    void registerWsKeyForNotes([...yNotes.keys()], wsId ? getCachedWorkspaceKey(wsId) : null);
  } catch (err) {
    // Sync prefix (store/key lookup): a throw here is an uncaught timer error
    // when the projection runs from a debounce, not a catchable rejection.
    console.warn('[meta-yjs] ws key registration skipped:', err?.message || err);
  }

  // A meta-doc pull used to force a full-list sweep (every note re-merged,
  // re-indexed, re-rendered) several times a minute on big shared workspaces.
  // Keep the per-id path instead: entries hydrate individually, and 'meta'
  // only forces the folder/label/color rebuilds plus eviction. Eviction reads
  // the full doc key set, so notes the doc still holds are never pruned.
  const sweptMeta = changedNoteIds instanceof Set && changedNoteIds.has('meta');
  const changedIds = changedNoteIds instanceof Set
    ? (sweptMeta ? new Set([...changedNoteIds].filter((id) => id !== 'meta')) : changedNoteIds)
    : null;
  const isInitialHydration = !metaChanges;
  let foldersNeedRebuild = isInitialHydration || metaChanges.folders || sweptMeta;
  let labelsNeedRebuild =
    isInitialHydration ||
    metaChanges.labels ||
    metaChanges.labelColors ||
    sweptMeta;

  // Folder counts derive from folderId (+ existence); rebuild the O(n) map
  // only when one of those actually changed instead of on every burst.
  let folderCountsDirty = isInitialHydration || sweptMeta;

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
      if (
        !existing.id ||
        existing.folderId !== merged.folderId ||
        existing.isArchived !== merged.isArchived
      ) {
        folderCountsDirty = true;
      }
      noteStore.data[id] = merged;
      // Remote/peered notes only reached the store here; without this they stay
      // unsearchable until the next launch rebuilds the index. Local saves
      // already re-indexed via saveNote → syncSearchIndex, so skip the
      // redundant re-tokenization when the index is known-current.
      if (!isSearchIndexCurrent(merged)) syncSearchIndex(merged);
    }

    if (evictRemovedNotes(noteStore, new Set(yNotes.keys())) > 0) {
      folderCountsDirty = true;
    }
  } else {
    for (const [id, yNote] of yNotes.entries()) {
      const meta = yMapToObj(yNote);
      const existing = noteStore.data[id] || {};
      const { note: merged, needsSnapshot } = mergeNoteEntry(existing, meta);
      if (needsSnapshot) pendingPreviews.push(id);
      if (
        !existing.id ||
        existing.folderId !== merged.folderId ||
        existing.isArchived !== merged.isArchived
      ) {
        folderCountsDirty = true;
      }
      noteStore.data[id] = merged;
      if (!isSearchIndexCurrent(merged)) syncSearchIndex(merged);
    }

    if (evictRemovedNotes(noteStore, new Set(yNotes.keys())) > 0) {
      folderCountsDirty = true;
    }
    // Full sweep: projections came from the whole doc, keep the old behavior.
    folderCountsDirty = true;
  }

  // Direct Yjs hydration bypasses the store's incremental counters. Skipped
  // when nothing folder-relevant changed: the version bump busts the Pinia
  // getter cache and used to force O(n) work + re-renders on every burst.
  if (folderCountsDirty) noteStore.rebuildFolderCounts();

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
              tmp.getXmlFragment('content'),
            );
            const merged = noteStore.data[id];
            if (!merged) continue;
            const text = extractTextFromContent(content);
            if (text) merged.searchText = text;
            const { cardPreview, preview } = buildNotePreviewFromContent(
              merged,
              content,
            );
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

/**
 * Cold-start helper: fill `searchText` for notes whose content lives only in
 * their per-note Yjs doc, so the search index can be rebuilt with full text.
 * One batched snapshot round-trip for the whole library.
 *
 * A note is skipped when its searchText already looks complete — i.e. it was
 * extracted from content (via editing) rather than copied from the truncated
 * workspace-doc `preview` (which is capped at 400 chars).
 */
export async function ensureSearchTextFromSnapshots(data) {
  const ids = [];
  for (const [id, note] of Object.entries(data)) {
    if (!note || note.isLocked || isEncryptedContent(note.content) || note.content) {
      continue;
    }
    if (note.searchText && !(note.preview && note.searchText === note.preview)) {
      continue;
    }
    ids.push(id);
  }
  if (ids.length === 0) return;

  let snapshots = {};
  try {
    snapshots = await getSnapshots(ids);
  } catch (err) {
    console.warn('[meta-yjs] search-text snapshot batch failed', err);
    return;
  }

  for (const id of ids) {
    const snapshot = snapshots?.[id];
    const note = data[id];
    if (!snapshot || snapshot.length === 0 || !note) continue;
    try {
      const tmp = new Y.Doc();
      Y.applyUpdate(tmp, toUint8Array(snapshot));
      const content = await yXmlFragmentToProsemirrorJSON(
        tmp.getXmlFragment('content')
      );
      const text = extractTextFromContent(content);
      if (!text) continue;
      note.searchText = text;
      if (!note.preview) note.preview = text;
      // saveNote syncs the entry into the MiniSearch index
      await saveNote(id, note);
    } catch (err) {
      console.warn('[meta-yjs] search-text extraction failed for', id, err);
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
  deletedFolderIds,
  excludeIds,
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
      // Notes skipped during conversion (empty/corrupt/no-id) get no meta,
      // so they can never strand as doc-less cards.
      if (excludeIds?.has(id)) continue;
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

/** Reader adoption for a received note: when the meta mirror never carried a
 * title, take the sharer's authored `title` Y.Text (they author it on every
 * keystroke). Legacy docs keep the title as an XmlFragment, which getText
 * rejects — same guard as useNoteYjs's migration path. */
export function adoptDocTitle(note, doc) {
  if (!note || note.title || !doc) return false;
  try {
    const docTitle = doc.getText('title').toString();
    if (docTitle) {
      note.title = docTitle;
      return true;
    }
  } catch {
    /* legacy XmlFragment title: leave the mirror as-is */
  }
  return false;
}

/**
 * One-time backfill: rebuild missing cardPreview plus preview from Yjs snapshots. Deferred, non-blocking, once per device.
 * Returns true when some snapshots were still missing (the caller should retry; a first pass that ran
 * before the pull finished would otherwise leave empty cards forever). */
export async function backfillNotePreviews() {
  const noteStore = useNoteStore();
  const needsSnapshot = [];
  for (const [id, note] of Object.entries(noteStore.data || {})) {
    if (!note || !id || note.isLocked) continue;
    if (note.cardPreview && note.cardPreview.blocks?.length) continue;
    if (isEncryptedContent(note.content)) continue;
    needsSnapshot.push(id);
  }
  if (needsSnapshot.length === 0) {
    // A boot-time pass that saw no notes at all must NOT mark the install done:
    // its notes have not been pulled yet, and later arrivals keep empty cards.
    return Object.keys(noteStore.data || {}).length ? 'complete' : 'later';
  }
  const unresolved = new Set(needsSnapshot);

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
    unresolved.delete(id);
    const tmp = new Y.Doc();
    try {
      Y.applyUpdate(tmp, toUint8Array(snapshot));
      // A received note whose meta entry never carried a title: adopt the
      // sharer's authored title instead of leaving the card "Untitled".
      adoptDocTitle(note, tmp);
      const content = await yXmlFragmentToProsemirrorJSON(
        tmp.getXmlFragment('content'),
      );
      // The store may have moved while the content was decoding (note
      // deleted, or a fresh meta write landed): carry the result onto the
      // live entry and skip when it is gone.
      const live = noteStore.data[id];
      if (!live) continue;
      if (!content || !content.content?.length) {
        if (note.title) {
          await saveNote(id, live);
          syncNoteMeta(live);
        }
        continue;
      }

      const previewText = extractTextFromContent(content);
      const { cardPreview, preview } = buildNotePreview({
        content,
        preview: previewText,
      });
      live.cardPreview = cardPreview;
      live.preview = preview;
      await saveNote(id, live);
      syncNoteMeta(live);
    } catch (err) {
      console.warn('[meta-yjs] preview backfill failed for', id, err);
    } finally {
      tmp.destroy();
    }
  }
  return unresolved.size > 0 ? 'later' : 'complete';
}

/** One-time repair: legacy imports once seeded meta without a Yjs doc, stranding
 * unopenable, undeletable cards. Any note missing a snapshot gets a valid empty
 * doc (never deleted: an absent snapshot may just not have arrived yet, and
 * deleting the meta would orphan the content permanently). Only id-less entries,
 * which can never own a doc, are dropped. Locked notes are left alone. */
export async function repairStrandedNotes() {
  let removeNoteMeta;
  try {
    ({ removeNoteMeta } = await import('./workspace-doc.js'));
  } catch (e) {
    console.warn('[meta-yjs] stranded repair: workspace-doc import failed', e);
    return { repaired: 0, dropped: 0, failed: 1 };
  }
  const yNotes = getWorkspaceDoc().getMap('notes');
  const dropIds = [];
  const checkIds = [];
  for (const [id, yNote] of yNotes.entries()) {
    if (!id) {
      // Id-less meta can never own a doc (the converter skips no-id notes
      // before converting): drop without a snapshot round-trip.
      dropIds.push(id);
      continue;
    }
    if (!yNote || typeof yNote.get !== 'function') continue;
    if (yNote.get('isLocked')) continue;
    checkIds.push(id);
  }
  let snapshots = {};
  if (checkIds.length > 0) {
    try {
      snapshots = await getSnapshots(checkIds);
    } catch (err) {
      console.warn('[meta-yjs] stranded repair snapshot batch failed', err);
      return { repaired: 0, dropped: 0, failed: 1 };
    }
  }
  const repairIds = [];
  for (const id of checkIds) {
    const snapshot = snapshots?.[id];
    if (snapshot && snapshot.length > 0) continue;
    repairIds.push(id);
  }
  let repaired = 0;
  let failed = 0;
  if (repairIds.length > 0) {
    try {
      // Empty paragraph, no schema/editor needed. Structurally identical to
      // what the converter writes for titled empty notes.
      const tmp = new Y.Doc();
      tmp.getXmlFragment('content').push([new Y.XmlElement('paragraph')]);
      const update = Y.encodeStateAsUpdate(tmp);
      tmp.destroy();
      const device = getDeviceId();
      await appendBatch(
        repairIds,
        repairIds.map(() => update),
        repairIds.map(() => device),
      );
      repaired = repairIds.length;
    } catch (err) {
      console.warn('[meta-yjs] stranded repair doc write failed', err);
      failed += repairIds.length;
    }
  }
  let dropped = 0;
  for (const id of dropIds) {
    try {
      removeNoteMeta(id);
      dropped++;
    } catch (err) {
      console.warn('[meta-yjs] stranded repair drop failed for', id, err);
      failed++;
    }
  }
  if (repaired > 0 || dropped > 0) {
    console.warn(
      `[meta-yjs] stranded repair: ${repaired} emptied, ${dropped} dropped`,
    );
  }
  return { repaired, dropped, failed };
}
