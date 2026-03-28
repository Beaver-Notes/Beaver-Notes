import { nanoid } from 'nanoid';
import { defineStore } from 'pinia';
import { useAppStore } from './app';
import { useFolderStore } from './folder';
import { useStorage } from '../composable/storage.js';
import { trackChange, trackDeletedAssets } from '@/utils/sync';
import { isAppEncryptionEnabled, isAppEncryptedContent } from '@/utils/appCrypto.js';
import { path } from '@/lib/tauri-bridge';
import { readDir, removePath } from '@/lib/native/fs';

import {
  stripTransientFields,
  hydrateNote,
  decryptNoteForMemory,
  encryptNoteForStorage,
} from '@/utils/noteSerializer.js';
import {
  encryptNoteWithPassword,
  decryptNoteWithPassword,
} from '@/utils/noteCrypto.js';
import {
  reconcileFootnotes,
  uncollapseHeadings,
} from '@/utils/noteContentUtils.js';

// ─── Module-level helpers ────────────────────────────────────────────────────

const storage = useStorage();

async function _trackNoteChange(id, note) {
  await trackChange(`notes.${id}`, stripTransientFields(note));
}

async function _saveNote(id, noteData) {
  const toStore = await encryptNoteForStorage(stripTransientFields(noteData));
  await storage.set(`notes.${id}`, toStore);
}

async function _resolveFolderId(folderId) {
  if (folderId === undefined || folderId === null) return null;
  const folderStore = useFolderStore();
  return folderStore.exists(folderId) ? folderId : null;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useNoteStore = defineStore('note', {
  state: () => ({
    data: {},
    lockStatus: {},
    isLocked: {},
    syncInProgress: false,
    deletedIds: {},
  }),

  // ── Getters ────────────────────────────────────────────────────────────────

  getters: {
    notes: (state) => Object.values(state.data).filter(({ id }) => id),

    getById: (state) => (id) => state.data[id],

    getByFolder:
      (state) =>
      (folderId = null) =>
        Object.values(state.data).filter(
          (note) => note.folderId === folderId && note.id
        ),

    getFolderContents:
      (state) =>
      (folderId = null) => {
        const folderStore = useFolderStore();

        const notes = Object.values(state.data)
          .filter((note) => note.folderId === folderId && note.id)
          .sort((a, b) => b.updatedAt - a.updatedAt);

        const folders = folderStore
          .getByParent(folderId)
          .sort((a, b) => a.name.localeCompare(b.name));

        return { folders, notes };
      },

    searchNotes: (state) => (query) => {
      const searchTerm = query.toLowerCase();
      return Object.values(state.data).filter((note) => {
        if (!note.id) return false;
        return (
          note.title.toLowerCase().includes(searchTerm) ||
          JSON.stringify(note.content).toLowerCase().includes(searchTerm)
        );
      });
    },

    getNotesWithPath:
      (state) =>
      (notes = null) => {
        const folderStore = useFolderStore();
        const notesToProcess =
          notes || Object.values(state.data).filter(({ id }) => id);
        return notesToProcess.map((note) => ({
          ...note,
          folderPath: note.folderId ? folderStore.getPath(note.folderId) : [],
        }));
      },

    getNotesCountByFolder:
      (state) =>
      (folderId = null) =>
        Object.values(state.data).filter(
          (note) => note.folderId === folderId && note.id
        ).length,
  },

  // ── Actions ────────────────────────────────────────────────────────────────

  actions: {
    // ── Load & hydration ──────────────────────────────────────────────────

    async retrieve() {
      try {
        const localStorageData = await storage.get('notes', {});
        const merged = { ...localStorageData, ...this.data };

        if (isAppEncryptionEnabled()) {
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
    },

    // ── App-encryption bulk operations ────────────────────────────────────

    async decryptAllNotesForAppEncryption(options = {}) {
      const { onProgress } = options;
      const entries = Object.entries(this.data).filter(([id]) => !!id);
      const total = entries.length;
      let processed = 0;
      const failures = [];

      for (const [id, note] of entries) {
        try {
          const wasEncrypted = isAppEncryptedContent(note.content);
          const decrypted = await decryptNoteForMemory(note);
          this.data[id] = hydrateNote(decrypted);

          if (wasEncrypted && isAppEncryptedContent(decrypted.content)) {
            failures.push(id);
            console.error(`[note] failed to decrypt app-encrypted note ${id} for migration`);
          }
        } catch (error) {
          failures.push(id);
          console.error(`[note] failed to normalize note ${id} before migration:`, error);
        } finally {
          processed += 1;
          onProgress?.({ phase: 'decrypt', processed, total, id });
        }
      }

      if (failures.length > 0) {
        throw new Error(`Failed to decrypt ${failures.length} note(s) for app-encryption migration.`);
      }
    },

    async persistAllNotesForAppEncryption(options = {}) {
      const { onProgress } = options;
      const entries = Object.entries(this.data).filter(([id]) => !!id);
      const total = entries.length;
      let processed = 0;
      const failures = [];

      for (const [id, note] of entries) {
        try {
          await _saveNote(id, note);
        } catch (error) {
          failures.push(id);
          console.error(`[note] failed to encrypt note ${id}:`, error);
        } finally {
          processed += 1;
          onProgress?.({ phase: 'encrypt', processed, total, id });
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `Failed to encrypt ${failures.length} note(s). Please retry after unlocking encryption key.`
        );
      }
    },

    async persistAllNotesPlaintext(options = {}) {
      const { onProgress } = options;
      const entries = Object.entries(this.data).filter(([id]) => !!id);
      const total = entries.length;
      let processed = 0;
      const failures = [];

      for (const [id, note] of entries) {
        try {
          await storage.set(`notes.${id}`, stripTransientFields(note));
        } catch (error) {
          failures.push(id);
          console.error(`[note] failed to persist plaintext note ${id}:`, error);
        } finally {
          processed += 1;
          onProgress?.({ phase: 'plaintext', processed, total, id });
        }
      }

      if (failures.length > 0) {
        throw new Error(`Failed to write ${failures.length} note(s) in plaintext.`);
      }
    },

    // ── Migration ─────────────────────────────────────────────────────────

    async migrateLockData() {
      const lockStatusData = await storage.get('lockStatus', {});
      const isLockedData = await storage.get('isLocked', {});

      const hasLegacyData =
        Object.keys(lockStatusData).length > 0 ||
        Object.keys(isLockedData).length > 0;

      if (!hasLegacyData) return;

      let hasChanges = false;

      for (const noteId in this.data) {
        const wasLocked =
          lockStatusData[noteId] === 'locked' || isLockedData[noteId] === true;

        if (wasLocked && !this.data[noteId].isLocked) {
          this.data[noteId] = hydrateNote({ ...this.data[noteId], isLocked: true });
          hasChanges = true;
        }
      }

      if (hasChanges) {
        for (const noteId in this.data) {
          await _saveNote(noteId, this.data[noteId]);
        }
        await this.retrieve();
      }

      await storage.delete('lockStatus');
      await storage.delete('isLocked');
    },

    // ── CRUD ──────────────────────────────────────────────────────────────

    async add(note = {}) {
      try {
        const folderId = await _resolveFolderId(note.folderId);
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
        await _saveNote(id, this.data[id]);
        await _trackNoteChange(id, this.data[id]);

        return this.data[id];
      } catch (error) {
        console.error('Error adding note:', error);
        throw error;
      }
    },

    async update(id, data = {}) {
      try {
        if (data.folderId !== undefined && data.folderId !== null) {
          const folderStore = useFolderStore();
          if (!await folderStore.exists(data.folderId)) {
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
    },

    patchLocal(id, data = {}) {
      if (!this.data[id]) return null;

      this.data[id] = hydrateNote({
        ...this.data[id],
        ...data,
        updatedAt: data.updatedAt ?? Date.now(),
      });

      return this.data[id];
    },

    async persist(id) {
      if (!this.data[id]) return null;

      await _saveNote(id, this.data[id]);
      await _trackNoteChange(id, this.data[id]);

      return this.data[id];
    },

    async delete(id) {
      try {
        const lastEditedNote = localStorage.getItem('lastNoteEdit');
        if (lastEditedNote === id) localStorage.removeItem('lastNoteEdit');

        const dataDir = await storage.get('dataDir', '', 'settings');

        this.deletedIds = this.deletedIds || {};
        if (!this.deletedIds[id]) {
          this.deletedIds[id] = Date.now();
        }

        await trackChange(`notes.${id}`, null);
        await trackChange('deletedIds', this.deletedIds);

        delete this.data[id];

        await storage.delete(`notes.${id}`);
        await storage.set('deletedIds', this.deletedIds);

        try {
          for (const assetType of ['notes-assets', 'file-assets']) {
            const assetDir = path.join(dataDir, assetType, id);
            try {
              const files = await readDir(assetDir);
              if (files?.length) await trackDeletedAssets(assetType, id, files);
            } catch {
              // Asset folder may not exist — that's fine
            }
            await removePath(path.join(dataDir, assetType, id));
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
    },

    async cleanupDeletedIds(days = 30) {
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
    },

    // ── Folder operations ─────────────────────────────────────────────────

    async moveToFolder(noteIds, folderId) {
      try {
        const targetFolderId = folderId ?? null;
        if (targetFolderId !== null) {
          const folderStore = useFolderStore();
          if (!await folderStore.exists(targetFolderId)) {
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
    },

    async handleFolderDeletion(deletionResult) {
      try {
        const { deletedFolderId, descendantIds, moveContentsTo, deleteContents } = deletionResult;

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
    },

    async normalizeInvalidFolderIds() {
      const folderStore = useFolderStore();
      const invalid = Object.values(this.data).filter(
        (note) => note?.id && note.folderId && !folderStore.exists(note.folderId)
      );

      for (const note of invalid) {
        this.patchLocal(note.id, { folderId: null });
        await this.persist(note.id);
      }

      return invalid.map((note) => note.id);
    },

    // ── Note locking ──────────────────────────────────────────────────────

    async lockNote(id, password) {
      if (!password) {
        console.error('No password provided.');
        return;
      }

      try {
        if (this.data[id].isLocked) return;

        const encryptedContent = await encryptNoteWithPassword(
          JSON.stringify(this.data[id].content),
          password
        );

        this.data[id] = hydrateNote({
          ...this.data[id],
          content: { type: 'doc', content: [encryptedContent] },
          isLocked: true,
          updatedAt: Date.now(),
        });

        await _saveNote(id, this.data[id]);
        await _trackNoteChange(id, this.data[id]);
      } catch (error) {
        console.error('Error locking note:', error);
        throw error;
      }
    },

    async unlockNote(id, password) {
      if (!password) {
        console.error('No password provided.');
        return;
      }

      try {
        const note = this.data[id];
        if (!note) {
          console.error('Note not found.');
          return;
        }
        if (!note.isLocked) return;

        const isEncrypted =
          typeof note.content.content[0] === 'string' &&
          note.content.content[0].trim().length > 0;

        if (!isEncrypted) {
          this.data[id] = hydrateNote({
            ...this.data[id],
            isLocked: false,
            updatedAt: Date.now(),
          });
          await _saveNote(id, this.data[id]);
          await _trackNoteChange(id, this.data[id]);
          return;
        }

        let decryptedContent, wasLegacy;
        try {
          ({ plaintext: decryptedContent, wasLegacy } = await decryptNoteWithPassword(
            this.data[id].content.content[0],
            password
          ));
        } catch {
          throw new Error('Incorrect password');
        }

        this.data[id].content = JSON.parse(decryptedContent);

        // Migrate legacy v1 ciphertext to v2 silently
        if (wasLegacy) {
          try {
            const v2cipher = await encryptNoteWithPassword(decryptedContent, password);
            await _saveNote(id, {
              ...this.data[id],
              content: { type: 'doc', content: [v2cipher] },
              isLocked: true,
            });
          } catch (migErr) {
            console.warn('[note] v1→v2 migration failed (non-fatal):', migErr);
          }
        }

        const appStore = useAppStore();
        if (!appStore.setting.collapsibleHeading) {
          this.convertNote(id);
        }

        this.data[id] = hydrateNote({
          ...this.data[id],
          isLocked: false,
          updatedAt: Date.now(),
        });

        await _saveNote(id, this.data[id]);
        await _trackNoteChange(id, this.data[id]);
      } catch (error) {
        console.error('Error unlocking note:', error);
        throw error;
      }
    },

    // ── Content helpers ───────────────────────────────────────────────────

    convertNote(id) {
      const note = this.data[id];
      const footnotes = [];
      note.content.content = uncollapseHeadings(note.content.content ?? [], footnotes);
      if (footnotes.length > 0) {
        reconcileFootnotes(note, footnotes);
      }
      this.data[id] = hydrateNote(note);
    },

    // Kept for backward-compatibility with any callers that reference the store method directly.
    uncollapseHeading(contents, footnotes) {
      return uncollapseHeadings(contents, footnotes);
    },

    // ── Labels ────────────────────────────────────────────────────────────

    async addLabel(id, labelId) {
      try {
        if (!this.data[id]) {
          console.error('Note not found');
          return;
        }

        if (this.data[id].labels.includes(labelId)) return labelId;

        this.data[id].labels.push(labelId);
        this.data[id].updatedAt = Date.now();

        await _saveNote(id, this.data[id]);
        await _trackNoteChange(id, this.data[id]);

        return labelId;
      } catch (error) {
        console.error('Error adding label:', error);
        throw error;
      }
    },

    async removeLabel(id, labelId) {
      try {
        if (!this.data[id]) {
          console.error('Note not found');
          return;
        }

        const idx = this.data[id].labels.indexOf(labelId);
        if (idx === -1) return;

        this.data[id].labels.splice(idx, 1);
        this.data[id].updatedAt = Date.now();

        await _saveNote(id, this.data[id]);
        await _trackNoteChange(id, this.data[id]);

        return labelId;
      } catch (error) {
        console.error('Error removing label:', error);
        throw error;
      }
    },
  },
});
