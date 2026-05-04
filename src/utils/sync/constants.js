/**
 * Sync layer constants.
 *
 * Centralises directory names, file extensions, storage keys, and operation
 * types so the sync engine has a single source of truth.
 */

// ─── Paths & Files ───────────────────────────────────────────────────────────

export const SYNC_ROOT_DIR = 'BeaverNotesSync';
export const COMMITS_DIR = 'commits';
export const CRYPTO_DIR = 'crypto';
export const ASSETS_DIR = 'assets';
export const SNAPSHOT_FILE = 'snapshot.json';
export const COMPACT_LOCK_FILE = 'compact.lock';

// ─── Extensions ──────────────────────────────────────────────────────────────

export const COMMIT_FILE_EXT = '.json';
export const ENCRYPTED_ASSET_EXT = '.enc';

// ─── Thresholds ──────────────────────────────────────────────────────────────

export const MAX_COMMITS_BEFORE_COMPACT = 200;

// ─── Asset Types ─────────────────────────────────────────────────────────────

export const ASSET_TYPES = Object.freeze(['notes-assets', 'file-assets']);

// ─── Storage Keys ────────────────────────────────────────────────────────────

export const STORAGE_KEY = Object.freeze({
  SYNC_CURSORS: 'syncCursors',
  SYNC_LOCAL_CLOCK: 'syncLocalClock',
  SYNC_PENDING_CHANGES: 'syncPendingChanges',
  SYNC_SNAPSHOT_TS: 'syncSnapshotTs',
  DELETED_ASSETS: 'deletedAssets',
});

// ─── Operation Types ─────────────────────────────────────────────────────────

export const OpType = Object.freeze({
  NOTES: 'notes',
  FOLDERS: 'folders',
  LABELS: 'labels',
  DELETED_IDS: 'deletedIds',
  DELETED_FOLDER_IDS: 'deletedFolderIds',
  LABEL_COLORS: 'labelColors',
  DELETED_ASSETS: 'deletedAssets',
});
