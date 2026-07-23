import { backend } from '@/lib/tauri-bridge';

export function appendUpdate(noteId, update, device = '') {
  return backend.invoke('yjs:append', { noteId, update, device });
}

export function getUpdates(noteId) {
  return backend.invoke('yjs:getUpdates', noteId);
}

export function getSnapshot(noteId) {
  return backend.invoke('yjs:getSnapshot', noteId);
}

export function compactUpdates(noteId, snapshot) {
  return backend.invoke('yjs:compact', { noteId, snapshot });
}

export function deleteUpdates(noteId) {
  return backend.invoke('yjs:delete', noteId);
}
