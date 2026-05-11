import { backend } from '@/lib/tauri-bridge';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

export function getAppInfo() {
  return backend.invoke('app:info');
}

export function getAppDirectory() {
  return backend.invoke('app:directory');
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

export function readLegacyData(dir) {
  return backend.invoke('migration:read-legacy-data', { dir });
}

export function writeLegacyData(dir, content) {
  return backend.invoke('migration:write-legacy-data', { dir, content });
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

export async function setZoomLevel(level) {
  try {
    const window = getCurrentWindow();
    await window.setZoom(level);
  } catch (error) {
    console.warn(
      'Failed to set window zoom, falling back to backend invoke:',
      error
    );
    return backend.invoke('app:set-zoom', level);
  }
}

export async function setReducedMotion(enabled) {
  return backend.invoke('app:set-reduced-motion', { enabled });
}

export async function getReducedMotion() {
  return backend.invoke('app:get-reduced-motion');
}

export async function setHighContrast(enabled) {
  return backend.invoke('app:set-high-contrast', { enabled });
}

export async function getHighContrast() {
  return backend.invoke('app:get-high-contrast');
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

export function relaunchApp() {
  return backend.invoke('helper:relaunch');
}

export async function showNotification(title, body) {
  let permissionGranted = await isPermissionGranted();
  if (!permissionGranted) {
    const permission = await requestPermission();
    permissionGranted = permission === 'granted';
  }
  if (permissionGranted) {
    sendNotification({ title, body });
  }
}
