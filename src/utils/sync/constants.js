export const SYNC_ROOT_DIR = 'BeaverNotesSync';
export const COMMITS_DIR = 'commits';
export const CRYPTO_DIR = 'crypto';
export const ASSETS_DIR = 'assets';
export const SNAPSHOT_FILE = 'snapshot.json';
export const COMPACT_LOCK_FILE = 'compact.lock';

export const COMMIT_FILE_EXT = '.json';
export const YJS_UPDATE_EXT = '.yjs.json';
export const ENCRYPTED_ASSET_EXT = '.enc';

export const MAX_COMMITS_BEFORE_COMPACT = 200;

export const ASSET_TYPES = Object.freeze(['assets']);

export const STORAGE_KEY = Object.freeze({
  SYNC_CURSORS: 'syncCursors',
  SYNC_LOCAL_CLOCK: 'syncLocalClock',
  SYNC_PENDING_CHANGES: 'syncPendingChanges',
  SYNC_SNAPSHOT_TS: 'syncSnapshotTs',
  DELETED_ASSETS: 'deletedAssets',
});

export const OpType = Object.freeze({
  NOTES: 'notes',
  FOLDERS: 'folders',
  LABELS: 'labels',
  LABEL_COLORS: 'labelColors',
  DELETED_ASSETS: 'deletedAssets',
});
