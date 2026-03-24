import {
  copyPath,
  ensureDir,
  pathExists,
  readData,
  readDir,
  readFile,
  removePath,
  writeFile,
} from '@/lib/native/fs';

export function ensureSyncDir(targetPath) {
  return ensureDir(targetPath);
}

export function readSyncDir(targetPath) {
  return readDir(targetPath);
}

export function readSyncFile(targetPath) {
  return readFile(targetPath);
}

export function readSyncData(targetPath) {
  return readData(targetPath);
}

export function writeSyncFile(targetPath, data, options = {}) {
  return writeFile(targetPath, data, options);
}

export function copySyncPath(sourcePath, destPath) {
  return copyPath(sourcePath, destPath);
}

export function removeSyncPath(targetPath) {
  return removePath(targetPath);
}

export function syncPathExists(targetPath) {
  return pathExists(targetPath);
}
