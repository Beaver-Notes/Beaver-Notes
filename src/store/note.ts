import { defineStore } from 'pinia';
import { NoteState } from './note/index';
import {
  notes,
  getById,
  getByFolder,
  getNotesCountByFolder,
  notesCountByFolder,
} from './note/index';
import {
  getFolderContents,
  searchNotes,
  searchNotesSql,
} from './note/index';
import {
  lockNote,
  unlockNote,
  convertNote,
} from './note/lock';
import {
  decryptAllNotesForAppEncryption,
  persistAllNotesForAppEncryption,
} from './note/encryption';
import {
  retrieve,
  add,
  addMany,
  update,
  patchLocal,
  persist,
  persistMeta,
  deleteNote,
  cleanupDeletedIds,
  moveToFolder,
  normalizeInvalidFolderIds,
  addLabel,
  removeLabel,
} from './note/index';
import { getBacklinks, getBacklinkCount } from './note/backlinks';

export const useNoteStore = defineStore('note', {
  state: (): NoteState => ({
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
    notesCountByFolder,
    getFolderContents,
    searchNotes,
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

    // CRUD
    add,
    addMany,
    update,
    patchLocal,
    persist,
    persistMeta,
    delete: deleteNote,
    cleanupDeletedIds,

    // Folder operations
    moveToFolder,
    normalizeInvalidFolderIds,

    // Note locking
    lockNote,
    unlockNote,
    convertNote,

    // Labels
    addLabel,
    removeLabel,
  },
});
