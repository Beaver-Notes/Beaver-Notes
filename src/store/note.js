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
import { getBacklinks, getBacklinkCount } from './note/backlinks';

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
    getBacklinks,
    getBacklinkCount,
  },

  actions: {
    // Search
    searchNotesSql,

    // Load & hydration
    retrieve,

    // App-encryption bulk operations
    decryptAllNotesForAppEncryption,
    persistAllNotesForAppEncryption,

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
