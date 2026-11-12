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

export function getContentVersion(noteId) {
  return backend.invoke('yjs:contentVersion', { noteId });
}

// Snapshot responses may arrive gzipped (newer binaries gzip the yjs bytes
// before base64 — detectable by the 0x1f 0x8b magic). Decompress natively;
// raw bytes pass through unchanged so older binaries keep working.
async function maybeGunzip(bytes) {
  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return bytes;
}

async function decodeSnapshotPayload(snapshot) {
  if (typeof snapshot !== 'string' || snapshot.length === 0) return snapshot;
  const { base64ToBuf } = await import('@/utils/crypto/codec.js');
  return maybeGunzip(base64ToBuf(snapshot));
}

export async function getSnapshot(noteId) {
  return decodeSnapshotPayload(await backend.invoke('yjs:getSnapshot', noteId));
}

export async function getSnapshots(noteIds) {
  const result = await backend.invoke('yjs:getSnapshots', noteIds);
  if (result && typeof result === 'object') {
    // Decompress chunks concurrently: each one is a base64 + gzip round trip
    // whose DecompressionStream runs off the main thread. With a heavy editor
    // mounted (49k elements) the main thread is busy with style/layout, so
    // decoding the 15 chunks sequentially inflates wall time (~1.8s vs ~0.4s
    // unmounted). Parallelizing overlaps the off-thread gunzip with that
    // contention instead of serializing behind it.
    await Promise.all(
      Object.entries(result).map(async ([id, snap]) => {
        if (typeof snap === 'string' && snap.length > 0) {
          try {
            result[id] = await decodeSnapshotPayload(snap);
          } catch { /* corrupt entry: leave raw, loader handles repair */ }
        }
      })
    );
  }
  return result;
}

export function compactUpdates(noteId, snapshot) {
  return backend.invoke('yjs:compact', { noteId, snapshot: toIpcBinary(snapshot) });
}

// Rust-side compaction: merges rows via yrs `merge_updates` off the main
// thread, no snapshot bytes over IPC. Channel maps via fallback
// (`sync:compact-note` → `sync_compact_note`), same as rust-shim sync:*.
export function compactNote(noteId) {
  return backend.invoke('sync:compact-note', { note_id: noteId, noteId });
}

export function deleteUpdates(noteId) {
  return backend.invoke('yjs:delete', noteId);
}
