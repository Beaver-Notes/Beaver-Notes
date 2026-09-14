import {
  deleteStoredValue,
  getStoredValue,
  setStoredValue,
} from '@/lib/native/storage';
import { settingsMirrorKey } from '@/lib/settings';

const LEGACY_KEY = 'default-path';

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

function readLegacySyncPath() {
  const namespaced = localStorage.getItem(settingsMirrorKey(LEGACY_KEY)) || '';
  const raw = localStorage.getItem(LEGACY_KEY) || '';
  // Migrate the pre-namespace shared key once, then drop it so a folder can
  // never leak from one instance to another.
  if (!namespaced && raw) {
    localStorage.setItem(settingsMirrorKey(LEGACY_KEY), raw);
    localStorage.removeItem(LEGACY_KEY);
  }
  return (namespaced || raw).trim();
}

function writeLegacySyncPath(value) {
  localStorage.setItem(settingsMirrorKey(LEGACY_KEY), value);
  localStorage.removeItem(LEGACY_KEY);
}

function clearLegacySyncPath() {
  localStorage.removeItem(settingsMirrorKey(LEGACY_KEY));
  localStorage.removeItem(LEGACY_KEY);
}

/** Resolve sync path from settings, fallback legacy key. Cached in memory, only setSyncPath writes. */
let cachedSyncPath = null;

export async function getSyncPath() {
  if (cachedSyncPath !== null) return cachedSyncPath;

  const legacy = readLegacySyncPath();
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
    writeLegacySyncPath(resolved);
  }

  cachedSyncPath = resolved;
  return resolved;
}

export async function setSyncPath(pathValue) {
  const normalized =
    typeof pathValue === 'string' ? pathValue.trim() : (pathValue ?? '');

  cachedSyncPath = normalized;

  if (!normalized) {
    clearLegacySyncPath();
    await clearPersistedSyncPath();
    return '';
  }

  writeLegacySyncPath(normalized);
  await persistSyncPath(normalized);
  return normalized;
}
