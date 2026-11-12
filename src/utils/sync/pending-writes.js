import { isRustSyncActive, kickRustDirty, kickRustSync } from './rust-shim.js';

// Dirty-kick only: native Rust owns durable sync. `noteId` is accepted for
// call-site symmetry; the Rust scheduler syncs every dirty note.
export function queueSyncWrite(noteId) {
  void noteId;
  if (isRustSyncActive()) kickRustDirty();
  else kickRustSync();
}

export function clearPendingWrites() {}
