import { nanoid } from 'nanoid';
import { path } from '@/lib/tauri-bridge';
import { getAppDirectory } from '@/lib/native/app';
import { readDir, removePath } from '@/lib/native/fs';
import { trackChange, trackDeletedAssets } from '@/utils/sync';
import { hydrateNote, stripTransientFields } from '@/utils/noteSerializer.js';
import { useFolderStore } from '../folder';
import {
  saveNote,
  trackNoteChange,
  resolveFolderId,
  storage,
  removeNoteFromFts,
} from './helpers';

// ─── Load & hydration ────────────────────────────────────────────────────────

export async function retrieve() {
  try {
    const localStorageData = await storage.get('notes', {});
    const merged = { ...localStorageData, ...this.data };

    if (this.isAppEncryptionEnabled?.() ?? false) {
      const { decryptNoteForMemory } = await import(
        '@/utils/noteSerializer.js'
      );
      await Promise.all(
        Object.keys(merged).map(async (id) => {
          merged[id] = await decryptNoteForMemory(merged[id]);
          merged[id] = hydrateNote(merged[id]);
        })
      );
    } else {
      Object.keys(merged).forEach((id) => {
        merged[id] = hydrateNote(merged[id]);
      });
    }

    this.data = merged;

    // Load and prune stale deleted-note IDs (>30 days old) on every launch
    const deletedIds = await storage.get('deletedIds', {});
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let deletedDirty = false;
    for (const id of Object.keys(deletedIds)) {
      if (deletedIds[id] < cutoff) {
        delete deletedIds[id];
        deletedDirty = true;
      }
    }
    if (deletedDirty) {
      await storage.set('deletedIds', deletedIds);
    }
    this.deletedIds = deletedIds;

    const migrationCompleted = await storage.get('migration_completed', false);
    if (!migrationCompleted) {
      await this.migrateLockData();
      await storage.set('migration_completed', true);
    }

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
      ...note,
      folderId,
    };

    this.data[id] = hydrateNote(newNote);
    await saveNote(id, this.data[id]);
    await trackNoteChange(id, this.data[id]);

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

    this.patchLocal(id, data);
    await this.persist(id);
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

  return this.data[id];
}

export async function deleteNote(id) {
  try {
    const lastEditedNote = localStorage.getItem('lastNoteEdit');
    if (lastEditedNote === id) localStorage.removeItem('lastNoteEdit');

    const appDirectory = await getAppDirectory();

    this.deletedIds = this.deletedIds || {};
    if (!this.deletedIds[id]) {
      this.deletedIds[id] = Date.now();
    }

    await trackChange(`notes.${id}`, null);
    await trackChange('deletedIds', this.deletedIds);

    delete this.data[id];

    await storage.delete(`notes.${id}`);
    removeNoteFromFts(id);
    await storage.set('deletedIds', this.deletedIds);

    try {
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
    } catch (fileError) {
      console.warn('Error removing note files:', fileError);
    }

    this.cleanupDeletedIds(30);
    return id;
  } catch (error) {
    console.error('Error deleting note:', error);
    throw error;
  }
}

export async function cleanupDeletedIds(days = 30) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const toDelete = Object.entries(this.deletedIds || {})
    .filter(([, timestamp]) => timestamp < cutoff)
    .map(([id]) => id);

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

    const results = [];
    for (const noteId of noteIds) {
      if (this.data[noteId]) {
        results.push(await this.update(noteId, { folderId: targetFolderId }));
      }
    }
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

    for (const note of affectedNotes) {
      if (deleteContents) {
        await this.delete(note.id);
      } else {
        await this.update(note.id, { folderId: moveContentsTo });
      }
    }

    return affectedNotes.map((note) => note.id);
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
