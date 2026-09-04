import { backend } from '@/lib/tauri-bridge';
import { bufToBase64 } from '@/utils/crypto/codec.js';

// Rust yjs commands take base64 strings. Tauri serializes Uint8Array as number array, rejected by serde: convert first.
function toIpcBinary(value) {
  if (value == null || typeof value === 'string') return value;
  if (value instanceof Uint8Array) return bufToBase64(value);
  if (value instanceof ArrayBuffer) return bufToBase64(new Uint8Array(value));
  if (Array.isArray(value)) return bufToBase64(new Uint8Array(value));
  return value;
}

export function appendUpdate(noteId, update, device = '') {
  return backend.invoke('yjs:append', { noteId, update: toIpcBinary(update), device });
}

export function appendBatch(noteIds, updates, devices) {
  return backend.invoke('yjs:appendBatch', {
    noteIds,
    updates: updates.map(toIpcBinary),
    devices,
  });
}

export function getUpdates(noteId) {
  return backend.invoke('yjs:getUpdates', noteId);
}

export function getStateVector(noteId) {
  return backend.invoke('yjs:getStateVector', { noteId });
}

export function getSnapshot(noteId) {
  return backend.invoke('yjs:getSnapshot', noteId);
}

export function getSnapshots(noteIds) {
  return backend.invoke('yjs:getSnapshots', noteIds);
}

export function compactUpdates(noteId, snapshot) {
  return backend.invoke('yjs:compact', { noteId, snapshot: toIpcBinary(snapshot) });
}

export function deleteUpdates(noteId) {
  return backend.invoke('yjs:delete', noteId);
}
