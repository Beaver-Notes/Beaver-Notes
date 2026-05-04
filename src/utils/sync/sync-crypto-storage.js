import { path } from '@/lib/tauri-bridge';
import {
  ensureSyncDir,
  readSyncData,
  readSyncFile,
  removeSyncPath,
  syncPathExists,
  writeSyncFile,
} from '@/lib/native/sync';
import { CRYPTO_DIR, SYNC_ROOT_DIR } from './constants.js';

export function getSyncCryptoDir(syncPath) {
  return path.join(syncPath, SYNC_ROOT_DIR, CRYPTO_DIR);
}

export function ensureSyncCryptoDir(syncPath) {
  return ensureSyncDir(getSyncCryptoDir(syncPath));
}

export function writeSyncCryptoFile(syncPath, name, data) {
  return writeSyncFile(path.join(getSyncCryptoDir(syncPath), name), data);
}

export function readSyncCryptoFile(syncPath, name) {
  return readSyncFile(path.join(getSyncCryptoDir(syncPath), name));
}

export function removeSyncCryptoDir(syncPath) {
  return removeSyncPath(getSyncCryptoDir(syncPath));
}

export function syncCryptoFileExists(syncPath, name) {
  return syncPathExists(path.join(getSyncCryptoDir(syncPath), name));
}

export function readLocalAssetData(localFilePath) {
  return readSyncData(localFilePath);
}
