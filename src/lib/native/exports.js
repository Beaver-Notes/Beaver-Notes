import { openDialog, saveDialog } from '@/lib/native/dialog';
import {
  copyPath,
  ensureDir,
  readData,
  readJson,
  writeFile,
  writeJson,
} from '@/lib/native/fs';

export function chooseExportDirectory(title) {
  return openDialog({
    title,
    properties: ['openDirectory'],
    useScopedStorage: true,
  });
}

export function saveExportFile(options) {
  return saveDialog(options);
}

export function ensureExportDir(targetPath) {
  return ensureDir(targetPath);
}

export function writeExportFile(targetPath, data, options = {}) {
  return writeFile(targetPath, data, options);
}

export function copyExportPath(sourcePath, destPath) {
  return copyPath(sourcePath, destPath);
}

export function readExportData(targetPath) {
  return readData(targetPath);
}

export function writeExportJson(targetPath, data) {
  return writeJson(targetPath, data);
}

export function readImportJson(targetPath) {
  return readJson(targetPath);
}
