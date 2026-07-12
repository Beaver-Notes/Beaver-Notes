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
