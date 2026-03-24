import { backend } from '@/lib/tauri-bridge';

export function ensureDir(targetPath) {
  return backend.invoke('fs:ensureDir', targetPath);
}

export function copyPath(path, dest) {
  return backend.invoke('fs:copy', { path, dest });
}

export function writeFile(path, data, options = {}) {
  return backend.invoke('fs:writeFile', {
    ...options,
    path,
    data,
  });
}

export function readFile(path) {
  return backend.invoke('fs:readFile', path);
}

export function readData(path) {
  return backend.invoke('fs:readData', path);
}

export function readDir(path) {
  return backend.invoke('fs:readdir', path);
}

export function pathExists(path) {
  return backend.invoke('fs:pathExists', path);
}

export function isFile(path) {
  return backend.invoke('fs:isFile', path);
}

export function removePath(path) {
  return backend.invoke('fs:remove', path);
}

export function writeJson(path, data) {
  return backend.invoke('fs:output-json', {
    path,
    data,
  });
}

export function readJson(path) {
  return backend.invoke('fs:read-json', path);
}
