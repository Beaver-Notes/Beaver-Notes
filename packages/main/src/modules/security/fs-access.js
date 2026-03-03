import path from 'path';
import fsExtra from 'fs-extra';
import { app } from 'electron';
import Store from 'electron-store';
import store from '../../store';

const fsAccessStore = new Store({ name: 'fs-access' });
const TRUSTED_ROOTS_KEY = 'trustedRoots';
const MAX_TRUSTED_ROOTS = 200;

function addRootIfString(roots, value) {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (!trimmed) return;
  roots.add(normalizePath(trimmed));
}

function normalizePath(inputPath) {
  return path.resolve(inputPath);
}

function tryRealpath(inputPath) {
  try {
    const real = fsExtra.realpathSync.native
      ? fsExtra.realpathSync.native(inputPath)
      : fsExtra.realpathSync(inputPath);
    return normalizePath(real);
  } catch {
    return null;
  }
}

function resolveComparablePath(inputPath) {
  const normalized = normalizePath(inputPath);
  const real = tryRealpath(normalized);
  if (real) return real;

  // For paths that do not exist yet, resolve the nearest existing parent.
  let cursor = normalized;
  while (!fsExtra.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) return normalized;
    cursor = parent;
  }

  const realParent = tryRealpath(cursor);
  if (!realParent) return normalized;

  return normalizePath(path.join(realParent, path.relative(cursor, normalized)));
}

function normalizeForCompare(inputPath) {
  const resolved = resolveComparablePath(inputPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isUnderRoot(targetPath, rootPath) {
  const target = normalizeForCompare(targetPath);
  const root = normalizeForCompare(rootPath);
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function getPersistedTrustedRoots() {
  const roots = fsAccessStore.get(TRUSTED_ROOTS_KEY, []);
  return Array.isArray(roots) ? roots : [];
}

function savePersistedTrustedRoots(roots) {
  fsAccessStore.set(TRUSTED_ROOTS_KEY, roots.slice(0, MAX_TRUSTED_ROOTS));
}

export function grantTrustedPath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') return;

  const normalized = normalizePath(inputPath);
  const current = getPersistedTrustedRoots();

  if (current.some((existing) => normalizeForCompare(existing) === normalizeForCompare(normalized))) {
    return;
  }

  current.push(normalized);
  savePersistedTrustedRoots(current);
}

export function grantTrustedDialogPaths(filePaths = []) {
  if (!Array.isArray(filePaths)) return;
  for (const selectedPath of filePaths) {
    if (!selectedPath || typeof selectedPath !== 'string') continue;
    grantTrustedPath(selectedPath);
    grantTrustedPath(path.dirname(selectedPath));
  }
}

function getAllowedRoots() {
  const roots = new Set();

  addRootIfString(roots, app.getPath('userData'));
  addRootIfString(roots, app.getPath('temp'));

  addRootIfString(roots, store.settings.get('dataDir'));

  // Backward compatibility: older builds and migrations may leave sync folder
  // values in non-canonical settings keys.
  addRootIfString(roots, store.settings.get('syncPath'));
  addRootIfString(roots, store.settings.get('defaultPath'));
  addRootIfString(roots, store.settings.get('default-path'));

  for (const trusted of getPersistedTrustedRoots()) {
    addRootIfString(roots, trusted);
  }

  return [...roots];
}

export function assertPathAccess(inputPath, operation = 'fs access') {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error(`[fs-access] Invalid path for ${operation}`);
  }

  const allowed = getAllowedRoots().some((root) => isUnderRoot(inputPath, root));
  if (!allowed) {
    throw new Error(
      `[fs-access] Blocked ${operation}: "${inputPath}". Re-select the folder/file from a system dialog to grant access.`,
    );
  }
}
