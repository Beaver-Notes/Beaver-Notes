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

// ─── Extensions ──────────────────────────────────────────────────────────────

export const YJS_UPDATE_EXT = '.yjs.json';
export const ENCRYPTED_ASSET_EXT = '.enc';

// ─── Asset Types ─────────────────────────────────────────────────────────────

export const ASSET_TYPES = Object.freeze(['notes-assets', 'file-assets']);

// ─── Storage Keys ────────────────────────────────────────────────────────────

export const STORAGE_KEY = Object.freeze({
  SYNC_CURSORS: 'syncCursors',
});
