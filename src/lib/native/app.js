import { backend } from '@/lib/tauri-bridge';

export function getAppInfo() {
  return backend.invoke('app:info');
}

export function getMigrationStatus() {
  return backend.invoke('migration:status');
}

export function runMigration() {
  return backend.invoke('migration:run');
}

export function probeMigrationPath(path) {
  return backend.invoke('migration:probe-path', path);
}

export function runMigrationFromPath(path) {
  return backend.invoke('migration:run-with-path', path);
}

export function appReady() {
  return backend.invoke('app-ready');
}

export function getSystemFonts() {
  return backend.invoke('get-system-fonts');
}

export function getNativeDarkTheme() {
  return backend.invoke('helper:is-dark-theme');
}

export function setSpellcheck(enabled) {
  return backend.invoke('app:spellcheck', enabled);
}

export function setMenuVisibility(visible) {
  return backend.invoke('app:change-menu-visibility', visible);
}

export function setZoomLevel(level) {
  return backend.invoke('app:set-zoom', level);
}

export function getHelperPath(name) {
  return backend.invoke('helper:get-path', name);
}

export function printPdf(pdfName) {
  return backend.invoke('print-pdf', { pdfName });
}

export function openFileExternal(path) {
  return backend.invoke('open-file-external', path);
}
