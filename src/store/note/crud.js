import { nanoid } from 'nanoid';
import { path } from '@/lib/tauri-bridge';
import { getAppDirectory } from '@/lib/native/app';
import { readDir, removePath } from '@/lib/native/fs';
import { trackChange, trackDeletedAssets } from '@/utils/sync';
import { hydrateNote } from '@/utils/note/serializer.js';
import { isEncryptionEnabled } from '@/utils/crypto/encryption.js';
import { PluginRegistry } from '@/plugins/PluginRegistry';
import { useFolderStore } from '../folder';
import { useUndoStore } from '../undo';
import {
  saveNote,
  trackNoteChange,
  resolveFolderId,
  storage,
  removeNoteFromFts,
} from './helpers';
import { reindexAllNotes } from '@/utils/platform/spotlightSync.js';
import { pruneExpiredIds, collectExpiredIds } from '@/utils/helpers/index.js';
import {
  rebuildLinkIndexForNote,
  removeNoteFromLinkIndex,
  rebuildLinkIndexFromAll,
} from './backlinks';

const _skipUndo = { value: false };

// ─── Load & hydration ────────────────────────────────────────────────────────

export async function retrieve() {
  try {
    const localStorageData = await storage.get('notes', {});
    const merged = { ...localStorageData, ...this.data };

    if (isEncryptionEnabled()) {
      const { decryptNoteForMemory } = await import(
        '@/utils/note/serializer.js'
      );
      await Promise.all(
        Object.keys(merged).map(async (id) => {
          merged[id] = await decryptNoteForMemory(merged[id]);
          if (merged[id]?.content) {
            merged[id].content = await PluginRegistry.runLoadTransforms(
              merged[id].content, id
            );
          }
          merged[id] = hydrateNote(merged[id]);
        })
      );
    } else {
      await Promise.all(
        Object.keys(merged).map(async (id) => {
          if (merged[id]?.content) {
            merged[id].content = await PluginRegistry.runLoadTransforms(
              merged[id].content, id
            );
          }
          merged[id] = hydrateNote(merged[id]);
        })
      );
    }

    this.data = merged;

    // Load and prune stale deleted-note IDs on every launch
    const deletedIds = await storage.get('deletedIds', {});
    if (pruneExpiredIds(deletedIds)) {
      await storage.set('deletedIds', deletedIds);
    }
    this.deletedIds = deletedIds;

    const migrationCompleted = await storage.get('migration_completed', false);
    if (!migrationCompleted) {
      await this.migrateLockData();
      await storage.set('migration_completed', true);
    }

    reindexAllNotes(this.data);
    rebuildLinkIndexFromAll(this.data);

    return this.data;
  } catch (error) {
    console.error('Error retrieving notes:', error);
    throw error;
  }
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function add(note = {}) {
  try {
    const folderId = await resolveFolderId(note.folderId);
    const id = note.id || nanoid();
    const newNote = {
      id,
      title: '',
      content: { type: 'doc', content: [] },
      labels: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isBookmarked: false,
      isArchived: false,
      isLocked: false,
      isFullWidth: false,
      ...note,
      folderId,
    };

    this.data[id] = hydrateNote(newNote);
    await saveNote(id, this.data[id]);
    await trackNoteChange(id, this.data[id]);
    rebuildLinkIndexForNote(id, this.data[id].content);

    emitAppEvent('note-created', id);

    return this.data[id];
  } catch (error) {
    console.error('Error adding note:', error);
    throw error;
  }
}

export async function update(id, data = {}) {
  try {
    if (data.folderId !== undefined && data.folderId !== null) {
      const folderStore = useFolderStore();
      if (!(await folderStore.exists(data.folderId))) {
        throw new Error('Specified folder does not exist');
      }
    }

    const prevBm = this.data[id]?.isBookmarked;
    const prevArch = this.data[id]?.isArchived;

    this.patchLocal(id, data);
    await this.persist(id);

    if (
      prevBm !== undefined &&
      data.isBookmarked !== undefined &&
      prevBm !== data.isBookmarked
    ) {
      useUndoStore().push({
        type: 'toggle-bookmark',
        notes: [{ id, prev: prevBm }],
      });
    }

    if (
      prevArch !== undefined &&
      data.isArchived !== undefined &&
      prevArch !== data.isArchived
    ) {
      useUndoStore().push({
        type: 'toggle-archive',
        notes: [{ id, prev: prevArch }],
        folders: [],
      });
    }

    return this.data[id];
  } catch (error) {
    console.error('Error updating note:', error);
    throw error;
  }
}

export function patchLocal(id, data = {}) {
  if (!this.data[id]) return null;

  this.data[id] = hydrateNote({
    ...this.data[id],
    ...data,
    updatedAt: data.updatedAt ?? Date.now(),
  });

  return this.data[id];
}

export async function persist(id) {
  if (!this.data[id]) return null;

  await saveNote(id, this.data[id]);
  await trackNoteChange(id, this.data[id]);
  rebuildLinkIndexForNote(id, this.data[id].content);

  emitAppEvent('note-saved', id);

  return this.data[id];
}

export async function deleteNote(id) {
  try {
    const snapshot =
      !_skipUndo.value && this.data[id]
        ? JSON.parse(JSON.stringify(this.data[id]))
        : null;

    const lastEditedNote = localStorage.getItem('lastNoteEdit');
    if (lastEditedNote === id) localStorage.removeItem('lastNoteEdit');

    this.deletedIds = this.deletedIds || {};
    if (!this.deletedIds[id]) {
      this.deletedIds[id] = Date.now();
    }

    delete this.data[id];
    removeNoteFromLinkIndex(id);
    await storage.delete(`notes.${id}`);

    await trackChange(`notes.${id}`, null);
    await trackChange('deletedIds', this.deletedIds);
    removeNoteFromFts(id);
    await storage.set('deletedIds', this.deletedIds);

    this.cleanupDeletedIds(30);

    // Best-effort cleanup of asset files on disk
    try {
      const appDirectory = await getAppDirectory();
      if (appDirectory) {
        for (const assetType of ['notes-assets', 'file-assets']) {
          const assetDir = path.join(appDirectory, assetType, id);
          try {
            const files = await readDir(assetDir);
            if (files?.length) await trackDeletedAssets(assetType, id, files);
          } catch {
            // Asset folder may not exist — that's fine
          }
          await removePath(path.join(appDirectory, assetType, id));
        }
      }
    } catch (fileError) {
      console.warn('Error removing note files:', fileError);
    }

    if (snapshot) {
      useUndoStore().push({
        type: 'bulk-delete',
        items: [{ type: 'note', data: snapshot }],
      });
    }

    emitAppEvent('note-deleted', id);

    return id;
  } catch (error) {
    console.error('Error deleting note:', error);
    throw error;
  }
}

export async function cleanupDeletedIds(days = 30) {
  const toDelete = collectExpiredIds(this.deletedIds, days);

  for (const id of toDelete) {
    delete this.deletedIds[id];
  }

  await storage.set('deletedIds', this.deletedIds);
  await trackChange('deletedIds', this.deletedIds);

  return toDelete;
}

// ─── Folder operations ───────────────────────────────────────────────────────

export async function moveToFolder(noteIds, folderId) {
  try {
    const targetFolderId = folderId ?? null;
    if (targetFolderId !== null) {
      const folderStore = useFolderStore();
      if (!(await folderStore.exists(targetFolderId))) {
        throw new Error('Target folder does not exist');
      }
    }

    const undoNotes = [];
    const results = [];
    for (const noteId of noteIds) {
      if (this.data[noteId]) {
        undoNotes.push({
          id: noteId,
          prevFolderId: this.data[noteId].folderId,
        });
        results.push(await this.update(noteId, { folderId: targetFolderId }));
      }
    }

    useUndoStore().push({ type: 'move', notes: undoNotes, folders: [] });
    return results;
  } catch (error) {
    console.error('Error moving multiple notes to folder:', error);
    throw error;
  }
}

export async function handleFolderDeletion(deletionResult) {
  try {
    const { deletedFolderId, descendantIds, moveContentsTo, deleteContents } =
      deletionResult;

    const affectedFolderIds = [deletedFolderId, ...descendantIds];
    const affectedNotes = Object.values(this.data).filter((note) =>
      affectedFolderIds.includes(note.folderId)
    );

    _skipUndo.value = true;
    for (const note of affectedNotes) {
      if (deleteContents) {
        await this.delete(note.id);
      } else {
        await this.update(note.id, { folderId: moveContentsTo });
      }
    }
    _skipUndo.value = false;

    const snapshots = deleteContents
      ? affectedNotes.map((note) => ({
          type: 'note',
          data: JSON.parse(JSON.stringify(note)),
        }))
      : [];

    return {
      noteIds: affectedNotes.map((note) => note.id),
      noteSnapshots: snapshots,
    };
  } catch (error) {
    console.error('Error handling folder deletion:', error);
    throw error;
  }
}

export async function normalizeInvalidFolderIds() {
  const folderStore = useFolderStore();
  const invalid = Object.values(this.data).filter(
    (note) => note?.id && note.folderId && !folderStore.exists(note.folderId)
  );

  for (const note of invalid) {
    this.patchLocal(note.id, { folderId: null });
    await this.persist(note.id);
  }

  return invalid.map((note) => note.id);
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export async function addLabel(id, labelId) {
  try {
    if (!this.data[id]) {
      console.error('Note not found');
      return;
    }

    if (this.data[id].labels.includes(labelId)) return labelId;

    this.data[id] = hydrateNote({
      ...this.data[id],
      labels: [...this.data[id].labels, labelId],
      updatedAt: Date.now(),
    });

    await saveNote(id, this.data[id]);
    await trackNoteChange(id, this.data[id]);

    return labelId;
  } catch (error) {
    console.error('Error adding label:', error);
    throw error;
  }
}

export async function removeLabel(id, labelId) {
  try {
    if (!this.data[id]) {
      console.error('Note not found');
      return;
    }

    const idx = this.data[id].labels.indexOf(labelId);
    if (idx === -1) return;

    const labels = [...this.data[id].labels];
    labels.splice(idx, 1);
    this.data[id] = hydrateNote({
      ...this.data[id],
      labels,
      updatedAt: Date.now(),
    });

    await saveNote(id, this.data[id]);
    await trackNoteChange(id, this.data[id]);

    return labelId;
  } catch (error) {
    console.error('Error removing label:', error);
    throw error;
  }
}
