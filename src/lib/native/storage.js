import { backend } from '@/lib/tauri-bridge';

export function getStore(name) {
  return backend.invoke('storage:store', name);
}

export function replaceStore(name, data) {
  return backend.invoke('storage:replace', { name, data });
}

export function getStoredValue(name, key, def = null) {
  return backend.invoke('storage:get', { name, key, def });
}

export function setStoredValue(name, key, value) {
  return backend.invoke('storage:set', { name, key, value });
}

export function deleteStoredValue(name, key) {
  return backend.invoke('storage:delete', { name, key });
}

export function hasStoredValue(name, key) {
  return backend.invoke('storage:has', { name, key });
}

export function clearStore(name) {
  return backend.invoke('storage:clear', name);
}
