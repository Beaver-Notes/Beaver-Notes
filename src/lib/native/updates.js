import { backend } from '@/lib/tauri-bridge';

export function checkForUpdates() {
  return backend.invoke('check-for-updates');
}

export function downloadUpdate() {
  return backend.invoke('download-update');
}

export function installUpdate() {
  return backend.invoke('install-update');
}

export function getAutoUpdateStatus() {
  return backend.invoke('get-auto-update-status');
}

export function toggleAutoUpdate(enabled) {
  return backend.invoke('toggle-auto-update', enabled);
}
