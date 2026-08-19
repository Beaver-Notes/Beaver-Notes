import { backend } from '@/lib/tauri-bridge';

export function appendUpdate(noteId, update, device = '') {
  return backend.invoke('yjs:append', { noteId, update, device });
}

export function appendBatch(noteIds, updates, devices) {
  return backend.invoke('yjs:appendBatch', { noteIds, updates, devices });
}

export function getUpdates(noteId) {
  return backend.invoke('yjs:getUpdates', noteId);
}

export function getStateVector(noteId) {
  return backend.invoke('yjs:getStateVector', noteId);
}

export function getSnapshot(noteId) {
  return backend.invoke('yjs:getSnapshot', noteId);
}

export function getSnapshots(noteIds) {
  return backend.invoke('yjs:getSnapshots', noteIds);
}

export function compactUpdates(noteId, snapshot) {
  return backend.invoke('yjs:compact', { noteId, snapshot });
}

export function deleteUpdates(noteId) {
  return backend.invoke('yjs:delete', noteId);
}
