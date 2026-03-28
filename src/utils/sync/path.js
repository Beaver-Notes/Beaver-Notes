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
 * Resolve sync path from canonical settings key, falling back to legacy
 * localStorage key. Keeps both locations aligned for backward compatibility.
 */
export async function getSyncPath() {
  const legacy = (localStorage.getItem('default-path') || '').trim();
  const persisted = await getPersistedSyncPath();
  const resolved = persisted || legacy;

  if (!resolved) return '';

  if (persisted !== resolved) {
    await persistSyncPath(resolved);
  }
  if (legacy !== resolved) {
    localStorage.setItem('default-path', resolved);
  }

  return resolved;
}

export async function setSyncPath(pathValue) {
  const normalized =
    typeof pathValue === 'string' ? pathValue.trim() : String(pathValue || '');

  if (!normalized) {
    localStorage.removeItem('default-path');
    await clearPersistedSyncPath();
    return '';
  }

  localStorage.setItem('default-path', normalized);
  await persistSyncPath(normalized);
  return normalized;
}
