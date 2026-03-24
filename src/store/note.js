import { nanoid } from 'nanoid';
import { defineStore } from 'pinia';
import { useAppStore } from './app';
import { useFolderStore } from './folder';
import { AES } from 'crypto-es/lib/aes.js';
import { useStorage } from '../composable/storage.js';
import { Utf8 } from 'crypto-es/lib/core.js';
import { trackChange, trackDeletedAssets } from '@/utils/sync.js';
import {
  isAppEncryptionEnabled,
  isAppKeyLoaded,
  encryptContent,
  decryptContent,
  isAppEncryptedContent,
} from '@/utils/appCrypto.js';
import {
  base64ToBuf,
  bufToBase64,
  bufToHex,
  deriveAesGcmKeyFromPassphrase,
  hexToBuf,
} from '@/utils/crypto-codec.js';
import { path } from '@/lib/tauri-bridge';
import { readDir, removePath } from '@/lib/native/fs';
import { buildCardPreview, EMPTY_CARD_PREVIEW } from '@/utils/cardPreview.js';

const storage = useStorage();

function _stripTransientNoteFields(note) {
  if (!note || typeof note !== 'object') return note;
  const { cardPreview, ...persistedNote } = note;
  return persistedNote;
}

function _hydrateNoteForMemory(note) {
  if (!note || typeof note !== 'object') return note;

  const persistedNote = _stripTransientNoteFields(note);
  const shouldHidePreview =
    persistedNote.isLocked || isAppEncryptedContent(persistedNote.content);

  return {
    ...persistedNote,
    cardPreview: shouldHidePreview
      ? EMPTY_CARD_PREVIEW
      : buildCardPreview(persistedNote.content),
  };
}

async function _trackNoteChange(id, note) {
  await trackChange(`notes.${id}`, _stripTransientNoteFields(note));
}

async function _decryptNoteForMemory(note) {
  if (!isAppEncryptedContent(note.content)) return note;
  const decrypted = await decryptContent(note.content);
  if (decrypted === null) return note; // key not loaded — keep encrypted in memory
  return { ...note, content: decrypted };
}

async function _encryptNoteForStorage(note) {
  if (!isAppEncryptionEnabled()) return note;
  if (!isAppKeyLoaded()) {
    throw new Error(
      'App encryption key is locked. Unlock app encryption in Settings before editing notes.'
    );
  }
  if (isAppEncryptedContent(note.content)) return note; // already encrypted
  const encrypted = await encryptContent(note.content);
  return { ...note, content: encrypted };
}

async function _saveNote(id, noteData) {
  const toStore = await _encryptNoteForStorage(
    _stripTransientNoteFields(noteData)
  );
  await storage.set(`notes.${id}`, toStore);
}

async function _resolveFolderId(folderId) {
  if (folderId === undefined || folderId === null) {
    return null;
  }

  const folderStore = useFolderStore();
  return folderStore.exists(folderId) ? folderId : null;
}

async function _noteKey(password, saltBuf) {
  return deriveAesGcmKeyFromPassphrase(password, saltBuf, {
    iterations: 100_000,
  });
}

async function _encryptNote(plaintext, password) {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await _noteKey(password, salt);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return JSON.stringify({
    v: 2,
    salt: bufToHex(salt),
    iv: bufToHex(iv),
    cipher: bufToBase64(new Uint8Array(ct)),
  });
}

async function _decryptNote(ciphertext, password) {
  // Try to parse as v2 JSON envelope first
  let parsed = null;
  try {
    parsed = JSON.parse(ciphertext);
  } catch {
    /* legacy */
  }

  if (parsed?.v === 2) {
    const key = await _noteKey(password, hexToBuf(parsed.salt));
    let buf;
    try {
      buf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: hexToBuf(parsed.iv) },
        key,
        base64ToBuf(parsed.cipher)
      );
    } catch {
      throw new Error('Incorrect password');
    }
    return { plaintext: new TextDecoder().decode(buf), wasLegacy: false };
  }

  try {
    const bytes = AES.decrypt(ciphertext, password);
    const plain = bytes.toString(Utf8);
    if (!plain) throw new Error();
    return { plaintext: plain, wasLegacy: true };
  } catch {
    throw new Error('Incorrect password');
  }
}

function findAllNodesInRange(fragment, name) {
  if (!fragment) {
    return [];
  }
  if (!Array.isArray(fragment)) {
    return findAllNodesInRange(fragment.content, name);
  }
  const nodes = [];
  for (const n of fragment) {
    if (n.type === name) {
      nodes.push(n);
      continue;
    }
    nodes.push(...findAllNodesInRange(n.content, name));
  }
  return nodes;
}

function unCollapsedFootnotes(note, footnotes) {
  let lastNode = note.content.content.at(-1);
  if (lastNode.type !== 'footnotes') {
    lastNode = {
      type: 'footnotes',
      content: [],
      attrs: { class: 'footnotes' },
    };
    note.content.content.push(lastNode);
  }
  const footnoteMap = [...footnotes, ...lastNode.content].reduce(
    (a, c) => ({ ...a, [c.attrs['data-id']]: c }),
    {}
  );
  const references = findAllNodesInRange(
    note.content.content,
    'footnoteReference'
  );
  lastNode.content = references.map((r, i) => {
    if (r.attrs['data-id'] in footnoteMap) {
      return footnoteMap[r.attrs['data-id']];
    }
    return {
      type: 'footnote',
      content: [
        {
          type: 'paragraph',
          content: [],
        },
      ],
      attrs: { 'data-id': r.attrs['data-id'], id: `fn:${i + 1}` },
    };
  });
}

export const useNoteStore = defineStore('note', {
  state: () => ({
    data: {},
    lockStatus: {},
    isLocked: {},
    syncInProgress: false,
    deletedIds: {},
  }),

  getters: {
    notes: (state) => Object.values(state.data).filter(({ id }) => id),

    getById: (state) => (id) => state.data[id],

    getByFolder:
      (state) =>
      (folderId = null) => {
        return Object.values(state.data).filter(
          (note) => note.folderId === folderId && note.id
        );
      },

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
      (folderId = null) => {
        return Object.values(state.data).filter(
          (note) => note.folderId === folderId && note.id
        ).length;
      },
  },

  actions: {
    async retrieve() {
      try {
        const localStorageData = await storage.get('notes', {});
        const piniaData = this.data;
        const merged = { ...localStorageData, ...piniaData };

        if (isAppEncryptionEnabled()) {
          await Promise.all(
            Object.keys(merged).map(async (id) => {
              merged[id] = await _decryptNoteForMemory(merged[id]);
              merged[id] = _hydrateNoteForMemory(merged[id]);
            })
          );
        } else {
          Object.keys(merged).forEach((id) => {
            merged[id] = _hydrateNoteForMemory(merged[id]);
          });
        }

        this.data = merged;

        const migrationCompleted = await storage.get(
          'migration_completed',
          false
        );
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

    async decryptAllNotesForAppEncryption(options = {}) {
      const { onProgress } = options;
      const entries = Object.entries(this.data).filter(([id]) => !!id);
      const total = entries.length;
      let processed = 0;
      const failures = [];

      for (const [id, note] of entries) {
        try {
          const wasEncrypted = isAppEncryptedContent(note.content);
          const decrypted = await _decryptNoteForMemory(note);
          this.data[id] = _hydrateNoteForMemory(decrypted);

          if (wasEncrypted && isAppEncryptedContent(decrypted.content)) {
            failures.push(id);
            console.error(
              `[note] failed to decrypt app-encrypted note ${id} for migration`
            );
          }
        } catch (error) {
          failures.push(id);
          console.error(
            `[note] failed to normalize note ${id} before migration:`,
            error
          );
        } finally {
          processed += 1;
          if (typeof onProgress === 'function') {
            onProgress({ phase: 'decrypt', processed, total, id });
          }
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `Failed to decrypt ${failures.length} note(s) for app-encryption migration.`
        );
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
          if (typeof onProgress === 'function') {
            onProgress({ phase: 'encrypt', processed, total, id });
          }
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
          await storage.set(`notes.${id}`, _stripTransientNoteFields(note));
        } catch (error) {
          failures.push(id);
          console.error(
            `[note] failed to persist plaintext note ${id}:`,
            error
          );
        } finally {
          processed += 1;
          if (typeof onProgress === 'function') {
            onProgress({ phase: 'plaintext', processed, total, id });
          }
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `Failed to write ${failures.length} note(s) in plaintext.`
        );
      }
    },

    async migrateLockData() {
      const lockStatusData = await storage.get('lockStatus', {});
      const isLockedData = await storage.get('isLocked', {});

      if (
        Object.keys(lockStatusData).length === 0 &&
        Object.keys(isLockedData).length === 0
      ) {
        console.log('No legacy lock data found, skipping migration');
        return;
      }

      let hasChanges = false;

      for (const noteId in this.data) {
        const wasLocked =
          lockStatusData[noteId] === 'locked' || isLockedData[noteId] === true;
        const currentLockStatus = this.data[noteId].isLocked;

        if (wasLocked && !currentLockStatus) {
          this.data[noteId] = _hydrateNoteForMemory({
            ...this.data[noteId],
            isLocked: true,
          });
          hasChanges = true;
          console.log(`Migrated lock status for note ${noteId}`);
        }
      }

      if (hasChanges) {
        for (const noteId in this.data) {
          await _saveNote(noteId, this.data[noteId]);
        }
        await this.retrieve();
      } else {
        console.log('Lock data migration completed - no changes needed');
      }

      await storage.delete('lockStatus');
      await storage.delete('isLocked');
    },

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
          folderId,
          ...note,
          folderId,
        };

        this.data[id] = _hydrateNoteForMemory(newNote);

        await _saveNote(id, this.data[id]);

        await _trackNoteChange(id, this.data[id]);

        return this.data[id];
      } catch (error) {
        console.error('Error adding note:', error);
        throw error;
      }
    },

    async moveToFolder(noteIds, folderId) {
      try {
        const folderStore = useFolderStore();
        const targetFolderId = folderId ?? null;
        if (targetFolderId !== null) {
          const folderExists = await folderStore.exists(targetFolderId);
          if (!folderExists) {
            throw new Error('Target folder does not exist');
          }
        }

        const results = [];
        for (const noteId of noteIds) {
          if (this.data[noteId]) {
            const result = await this.update(noteId, {
              folderId: targetFolderId,
            });
            results.push(result);
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
        const {
          deletedFolderId,
          descendantIds,
          moveContentsTo,
          deleteContents,
        } = deletionResult;

        const affectedFolderIds = [deletedFolderId, ...descendantIds];
        const affectedNotes = Object.values(this.data).filter((note) =>
          affectedFolderIds.includes(note.folderId)
        );

        if (deleteContents) {
          for (const note of affectedNotes) {
            await this.delete(note.id);
          }
        } else {
          for (const note of affectedNotes) {
            await this.update(note.id, { folderId: moveContentsTo });
          }
        }

        return affectedNotes.map((note) => note.id);
      } catch (error) {
        console.error('Error handling folder deletion:', error);
        throw error;
      }
    },

    convertNote(id) {
      const note = this.data[id];
      let footnotes = [];
      note.content.content = this.uncollapseHeading(
        note.content.content ?? [],
        footnotes
      );
      if (footnotes.length > 0) {
        unCollapsedFootnotes(note, footnotes);
      }
      this.data[id] = _hydrateNoteForMemory(note);
    },

    uncollapseHeading(contents, footnotes) {
      if (contents.length === 0) {
        return contents;
      }
      let newContents = [];
      for (let i = 0; i < contents.length; i++) {
        const content = contents[i];
        newContents.push(content);
        if (content.type === 'heading') {
          let collapsedContent = content.attrs.collapsedContent ?? [];
          let collapsedFootnotes = content.attrs.collapsedFootnotes ?? [];
          if (collapsedFootnotes.length > 0) {
            footnotes.push(...collapsedFootnotes);
          }
          if (typeof collapsedContent === 'string') {
            if (collapsedContent === '') {
              collapsedContent = [];
            } else {
              collapsedContent = JSON.parse(collapsedContent);
            }
          }
          content.attrs.open = true;
          content.attrs.collapsedContent = null;
          content.attrs.collapsedFootnotes = null;
          if (collapsedContent.length === 0) {
            continue;
          }
          newContents = [
            ...newContents,
            ...this.uncollapseHeading(collapsedContent, footnotes),
          ];
        }
      }
      return newContents;
    },

    async update(id, data = {}) {
      try {
        if (data.folderId !== undefined && data.folderId !== null) {
          const folderStore = useFolderStore();
          const folderExists = await folderStore.exists(data.folderId);
          if (!folderExists) {
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

      this.data[id] = {
        ...this.data[id],
        ...data,
        updatedAt: data.updatedAt ?? Date.now(),
      };

      this.data[id] = _hydrateNoteForMemory(this.data[id]);

      return this.data[id];
    },

    async persist(id) {
      if (!this.data[id]) return null;

      await _saveNote(id, this.data[id]);
      await _trackNoteChange(id, this.data[id]);

      return this.data[id];
    },

    async normalizeInvalidFolderIds() {
      const folderStore = useFolderStore();
      const notesWithInvalidFolderId = Object.values(this.data).filter(
        (note) =>
          note?.id && note.folderId && !folderStore.exists(note.folderId)
      );

      for (const note of notesWithInvalidFolderId) {
        this.patchLocal(note.id, { folderId: null });
        await this.persist(note.id);
      }

      return notesWithInvalidFolderId.map((note) => note.id);
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
              if (files?.length) {
                await trackDeletedAssets(assetType, id, files);
              }
            } catch {
              // Folder may not exist — that's fine
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
      const toDelete = [];

      for (const [id, timestamp] of Object.entries(this.deletedIds || {})) {
        if (timestamp < cutoff) {
          toDelete.push(id);
        }
      }

      for (const id of toDelete) {
        delete this.deletedIds[id];
      }

      await storage.set('deletedIds', this.deletedIds);
      await trackChange('deletedIds', this.deletedIds);

      return toDelete;
    },

    async lockNote(id, password) {
      if (!password) {
        console.error('No password provided.');
        return;
      }

      try {
        if (this.data[id].isLocked) {
          console.log('Note is already locked');
          return;
        }

        const encryptedContent = await _encryptNote(
          JSON.stringify(this.data[id].content),
          password
        );

        this.data[id].content = { type: 'doc', content: [encryptedContent] };
        this.data[id].isLocked = true;
        this.data[id].updatedAt = Date.now();
        this.data[id] = _hydrateNoteForMemory(this.data[id]);

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

        if (!note.isLocked) {
          console.log('Note is not locked');
          return;
        }

        const isEncrypted =
          typeof note.content.content[0] === 'string' &&
          note.content.content[0].trim().length > 0;

        if (!isEncrypted) {
          this.data[id] = _hydrateNoteForMemory({
            ...this.data[id],
            isLocked: false,
            updatedAt: Date.now(),
          });

          await _saveNote(id, this.data[id]);
          await _trackNoteChange(id, this.data[id]);
          return;
        }

        let decryptedContent;
        let wasLegacy;
        try {
          ({ plaintext: decryptedContent, wasLegacy } = await _decryptNote(
            this.data[id].content.content[0],
            password
          ));
        } catch (decryptError) {
          console.error('Failed to decrypt note:', decryptError);
          throw new Error('Incorrect password');
        }

        this.data[id].content = JSON.parse(decryptedContent);

        if (wasLegacy) {
          try {
            const v2cipher = await _encryptNote(decryptedContent, password);
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

        this.data[id] = _hydrateNoteForMemory({
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

    async addLabel(id, labelId) {
      try {
        if (!this.data[id]) {
          console.error('Note not found');
          return;
        }

        const labelIndex = this.data[id].labels.indexOf(labelId);
        if (labelIndex !== -1) {
          return labelId;
        }

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

        const labelIndex = this.data[id].labels.indexOf(labelId);
        if (labelIndex === -1) {
          return;
        }

        this.data[id].labels.splice(labelIndex, 1);
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
