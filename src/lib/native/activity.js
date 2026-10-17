import { backend } from '@/lib/tauri-bridge';

export function appendActivity(entries) {
  return backend.invoke('activity:append', { entries });
}

export function listActivity(noteId, { limit = null, before = null } = {}) {
  return backend.invoke('activity:list', { noteId, limit, before });
}

export function clearActivity(noteId) {
  return backend.invoke('activity:clear', { noteId });
}
