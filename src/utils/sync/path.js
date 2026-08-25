import {
  deleteStoredValue,
  getStoredValue,
  setStoredValue,
} from '@/lib/native/storage';

async function getPersistedSyncPath() {
  try {
    const value = await getStoredValue('settings', 'syncPath', '');
    return typeof value === 'string' ? value.trim() : '';
  } catch {
    return '';
  }
}

async function persistSyncPath(pathValue) {
  try {
    await setStoredValue('settings', 'syncPath', pathValue);
  } catch {
    // non-fatal
  }
}

async function clearPersistedSyncPath() {
  try {
    await deleteStoredValue('settings', 'syncPath');
  } catch {
    // non-fatal
  }
}

/**
 * Resolve sync path from the canonical settings key, falling back to the
 * legacy localStorage key (kept aligned for backward compat). Cached in
 * memory — read on every Yjs update; setSyncPath() is the only writer.
 */
let cachedSyncPath = null;

export async function getSyncPath() {
  if (cachedSyncPath !== null) return cachedSyncPath;

  const legacy = (localStorage.getItem('default-path') || '').trim();
  const persisted = await getPersistedSyncPath();
  const resolved = persisted || legacy;

  if (!resolved) {
    cachedSyncPath = '';
    return '';
  }

  if (persisted !== resolved) {
    await persistSyncPath(resolved);
  }
  if (legacy !== resolved) {
    localStorage.setItem('default-path', resolved);
  }

  cachedSyncPath = resolved;
  return resolved;
}

export async function setSyncPath(pathValue) {
  const normalized =
    typeof pathValue === 'string' ? pathValue.trim() : (pathValue ?? '');

  cachedSyncPath = normalized;

  if (!normalized) {
    localStorage.removeItem('default-path');
    await clearPersistedSyncPath();
    return '';
  }

  localStorage.setItem('default-path', normalized);
  await persistSyncPath(normalized);
  return normalized;
}
