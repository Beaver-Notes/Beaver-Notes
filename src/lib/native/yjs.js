import { backend } from '@/lib/tauri-bridge';
import { bufToBase64 } from '@/utils/crypto/codec.js';

// The Rust yjs commands declare update/snapshot params as base64 STRINGS
// (f97c8f63). Tauri serializes a nested Uint8Array as a JSON number array,
// which serde rejects — so raw bytes must be converted before invoke.
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
  return backend.invoke('yjs:getStateVector', noteId);
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
