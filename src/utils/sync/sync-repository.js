import { invoke } from '@tauri-apps/api/core';
import { path } from '@/lib/tauri-bridge';
import {
  ensureDir as ensureSyncDir,
} from '@/lib/native/fs';
import {
  COMMITS_DIR,
  SYNC_ROOT_DIR,
} from './constants.js';

let cachedDeviceId = null;

function readLegacyDeviceId() {
  try {
    return localStorage.getItem('deviceId') || null;
  } catch {
    return null;
  }
}

// Rust kv `sync:local:device-id` is the single source; the legacy localStorage UUID is passed as seed and adopted only when kv is absent, so existing installs keep their identity.
export async function getSyncDeviceId() {
  if (cachedDeviceId) return cachedDeviceId;
  const legacy = readLegacyDeviceId();
  try {
    const id = await invoke('sync_device_id', legacy ? { seed: legacy } : {});
    if (typeof id === 'string' && id.trim()) {
      cachedDeviceId = id;
      try {
        localStorage.setItem('deviceId', id);
      } catch {}
      return cachedDeviceId;
    }
  } catch {}
  if (legacy) {
    cachedDeviceId = legacy;
    return cachedDeviceId;
  }
  try {
    const id = typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : `local-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    try { localStorage.setItem('deviceId', id); } catch {}
    cachedDeviceId = id;
  } catch {
    cachedDeviceId = `local-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
  return cachedDeviceId;
}

export async function ensureCommitsDir(syncPath) {
  const commitsDir = path.join(syncPath, SYNC_ROOT_DIR, COMMITS_DIR);
  await ensureSyncDir(commitsDir);
  return commitsDir;
}

let cachedCommitsDir = null;
let cachedCommitsDirFor = null;

/**
 * Resolves the active commits directory: the local sync folder if configured,
 * else a private app-support directory for cloud sync. Folder result is
 * memoized per path (resolved on every Yjs update); setSyncPath() invalidates it.
 */
export async function getCommitsDir() {
  const { getSyncPath } = await import('./path.js');
  const syncPath = await getSyncPath();
  if (syncPath && syncPath.trim()) {
    if (cachedCommitsDirFor === syncPath && cachedCommitsDir) {
      return cachedCommitsDir;
    }
    const dir = await ensureCommitsDir(syncPath);
    cachedCommitsDirFor = syncPath;
    cachedCommitsDir = dir;
    return dir;
  }

  try {
    const { getSettingSync } = await import('@/lib/settings');
    const transportSetting = getSettingSync('syncTransport') || 'folder';
    const { SYNC_TRANSPORT, normalizeSyncTransport } = await import('@/lib/api/types.js');
    const { useAccountStore } = await import('@/store/account');
    const accountStore = useAccountStore();

    const remoteAllowed =
      normalizeSyncTransport(transportSetting) === SYNC_TRANSPORT.REMOTE &&
      accountStore.isAuthenticated;

    if (remoteAllowed) {
      const { getAppDirectory } = await import('@/lib/native/app');
      const appDir = await getAppDirectory();
      if (appDir) {
        return ensureCommitsDir(appDir);
      }
    }
  } catch (err) {
    console.warn('[sync] failed to resolve fallback commitsDir:', err);
  }

  return null;
}
