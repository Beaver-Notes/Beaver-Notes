import { defineStore } from 'pinia';
import {
  notes,
  getById,
  getByFolder,
  getNotesCountByFolder,
} from './note/search';
import {
  getFolderContents,
  searchNotes,
  getNotesWithPath,
  searchNotesSql,
} from './note/search';
import {
  lockNote,
  unlockNote,
  convertNote,
  uncollapseHeading,
  migrateLockData,
} from './note/lock';
import {
  decryptAllNotesForAppEncryption,
  persistAllNotesForAppEncryption,
  persistAllNotesPlaintext,
} from './note/encryption';
import {
  retrieve,
  add,
  update,
  patchLocal,
  persist,
  deleteNote,
  cleanupDeletedIds,
  moveToFolder,
  handleFolderDeletion,
  normalizeInvalidFolderIds,
  addLabel,
  removeLabel,
} from './note/crud';

export const useNoteStore = defineStore('note', {
  state: () => ({
    data: {},
    lockStatus: {},
    isLocked: {},
    syncInProgress: false,
    deletedIds: {},
  }),

  getters: {
    notes,
    getById,
    getByFolder,
    getNotesCountByFolder,
    getFolderContents,
    searchNotes,
    getNotesWithPath,
  },

  actions: {
    // Search
    searchNotesSql,

    // Load & hydration
    retrieve,

    // App-encryption bulk operations
    decryptAllNotesForAppEncryption,
    persistAllNotesForAppEncryption,
    persistAllNotesPlaintext,

    // Migration
    migrateLockData,

    // CRUD
    add,
    update,
    patchLocal,
    persist,
    delete: deleteNote,
    cleanupDeletedIds,

    // Folder operations
    moveToFolder,
    handleFolderDeletion,
    normalizeInvalidFolderIds,

    // Note locking
    lockNote,
    unlockNote,
    convertNote,
    uncollapseHeading,

    // Labels
    addLabel,
    removeLabel,
  },
});
