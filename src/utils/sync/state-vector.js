/**
 * State-vector storage for Yjs sync.
 *
 * Instead of per-device timestamp cursors, we store a compact JSON object
 * `{ [deviceId]: clock }` per note.  This is derived from the Rust backend's
 * y-octo state vector and lets us quickly check whether a remote update is
 * already known without reading or decrypting the file.
 *
 * The state vector is NOT a binary-encoded Yjs state vector — it is a plain
 * JSON map produced by the `yjs:getStateVector` IPC command (which returns
 * `HashMap<String, i64>` from y-octo).  This avoids compatibility issues
 * between y-octo's string client IDs and yjs's numeric client IDs.
 */

import { getStateVector } from '@/lib/native/yjs.js';

const STORAGE_KEY = 'syncStateVectors';

/**
 * Load the stored state vector for a document.
 * @param {string} docId
 * @returns {Record<string, number>|null} e.g. { "device-a": 5, "device-b": 12 } or null
 */
export function loadStateVector(docId) {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${docId}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Save a state vector for a document.
 * @param {string} docId
 * @param {Record<string, number>} sv — e.g. { "device-a": 5 }
 */
export function saveStateVector(docId, sv) {
  try {
    localStorage.setItem(`${STORAGE_KEY}:${docId}`, JSON.stringify(sv));
  } catch {
    // storage full or unavailable — non-critical
  }
}

/**
 * Get the current state vector from the Rust backend for a note.
 * Returns a JSON object `{ [deviceId]: clock }`, or `{}` if no data.
 */
export async function getCurrentStateVector(docId) {
  try {
    const sv = await getStateVector(docId);
    return sv && typeof sv === 'object' ? sv : {};
  } catch (err) {
    console.warn('[state-vector] getCurrentStateVector failed for', docId, err);
    return {};
  }
}

/**
 * Check whether a remote update is already included in the local state.
 * Uses the stored state vector to avoid re-applying known updates.
 *
 * @param {string} docId
 * @param {{ device: string, seq?: number }} updateMetadata
 * @returns {boolean} true if the update is already known
 */
export function isUpdateKnown(docId, updateMetadata) {
  const sv = loadStateVector(docId);
  if (!sv) return false;

  const clientClock = sv[updateMetadata.device];
  if (clientClock == null) return false;

  // If we have state from this client and the update's seq is at or below
  // what we've seen, skip it.
  if (updateMetadata.seq != null) {
    return updateMetadata.seq <= clientClock;
  }
  return false;
}

/**
 * Merge a remote state vector with our stored one for a document.
 * After applying updates from a remote, save the merged state.
 *
 * @param {string} docId
 * @param {Record<string, number>} remoteSV — e.g. { "device-b": 8 }
 * @returns {Record<string, number>} merged state vector
 */
export function mergeStateVectors(docId, remoteSV) {
  const localSV = loadStateVector(docId);
  if (!localSV || Object.keys(localSV).length === 0) {
    saveStateVector(docId, remoteSV);
    return remoteSV;
  }
  const merged = { ...localSV };
  for (const [device, clock] of Object.entries(remoteSV)) {
    if (clock > (merged[device] ?? 0)) {
      merged[device] = clock;
    }
  }
  saveStateVector(docId, merged);
  return merged;
}

// ── Server checkpoint storage (for cloud pull efficiency) ────────────────────
// The cloud server uses per-device { ts, sequence } checkpoints for its
// pull-batch endpoint.  Storing the server's nextCheckpoint after each pull
// lets us send only NEW updates on the next pull instead of re-downloading
// everything.

const CHECKPOINT_STORAGE_KEY = 'syncServerCheckpoints';

/**
 * Load the stored server checkpoint for a note.
 * @param {string} noteId
 * @returns {Record<string, {ts: number, sequence: number}>|null} e.g. { "device-a": { ts: 123, sequence: 5 } }
 */
export function loadServerCheckpoint(noteId) {
  try {
    const raw = localStorage.getItem(`${CHECKPOINT_STORAGE_KEY}:${noteId}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Save a server checkpoint for a note.
 * @param {string} noteId
 * @param {Record<string, {ts: number, sequence: number}>} checkpoint
 */
export function saveServerCheckpoint(noteId, checkpoint) {
  try {
    if (checkpoint && Object.keys(checkpoint).length > 0) {
      localStorage.setItem(`${CHECKPOINT_STORAGE_KEY}:${noteId}`, JSON.stringify(checkpoint));
    }
  } catch {
    // storage full or unavailable — non-critical
  }
}
