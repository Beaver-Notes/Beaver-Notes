import { path } from '@/lib/tauri-bridge';
import {
  ensureDir as ensureSyncDir,
} from '@/lib/native/fs';
import {
  COMMITS_DIR,
  SYNC_ROOT_DIR,
} from './constants.js';

let deviceId =
  localStorage.getItem('deviceId') ||
  (() => {
    const id = crypto.randomUUID();
    localStorage.setItem('deviceId', id);
    return id;
  })();

export function getSyncDeviceId() {
  return deviceId;
}

export async function ensureCommitsDir(syncPath) {
  const commitsDir = path.join(syncPath, SYNC_ROOT_DIR, COMMITS_DIR);
  await ensureSyncDir(commitsDir);
  return commitsDir;
}

/**
 * Resolves the active commits directory.
 * If a local folder sync path is set, it uses that.
 * If no local folder is configured, but the transport is cloud (REMOTE) sync,
 * it falls back to a private sync directory in the application support folder.
 */
export async function getCommitsDir() {
  const { getSyncPath } = await import('./path.js');
  const syncPath = await getSyncPath();
  if (syncPath && syncPath.trim()) {
    return ensureCommitsDir(syncPath);
  }

  try {
    const { getSettingSync } = await import('@/composable/settings');
    const transportSetting = getSettingSync('syncTransport') || 'folder';
    const { SYNC_TRANSPORT, isPaidPlan } = await import('@/lib/api/types.js');
    const { useAccountStore } = await import('@/store/account');
    const accountStore = useAccountStore();

    const remoteAllowed =
      transportSetting === SYNC_TRANSPORT.REMOTE &&
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
