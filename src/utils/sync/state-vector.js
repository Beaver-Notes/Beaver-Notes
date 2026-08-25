/**
 * Per-note state-vector storage for Yjs sync: a plain JSON map
 * `{ [deviceId]: clock }` derived from the Rust backend's y-octo state vector.
 * Deliberately NOT a binary Yjs state vector — y-octo uses string client IDs
 * vs. yjs's numeric ones.
 */

import { getStateVector } from '@/lib/native/yjs.js';

const STORAGE_KEY = 'syncStateVectors';

export function loadStateVector(docId) {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${docId}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveStateVector(docId, sv) {
  try {
    localStorage.setItem(`${STORAGE_KEY}:${docId}`, JSON.stringify(sv));
  } catch {
    // storage full or unavailable — non-critical
  }
}

/** Returns the current `{ [deviceId]: clock }` map, or `{}` if none. */
export async function getCurrentStateVector(docId) {
  try {
    const sv = await getStateVector(docId);
    return sv && typeof sv === 'object' ? sv : {};
  } catch (err) {
    console.warn('[state-vector] getCurrentStateVector failed for', docId, err);
    return {};
  }
}

/** True when the update's sequence is already covered by the stored vector. */
export function isUpdateKnown(docId, updateMetadata) {
  const sv = loadStateVector(docId);
  if (!sv) return false;

  const clientClock = sv[updateMetadata.device];
  if (clientClock == null) return false;

  if (updateMetadata.sequence != null) {
    return updateMetadata.sequence <= clientClock;
  }
  return false;
}

/** Merge a remote state vector into the stored one (max wins) and persist. */
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

// ── Server checkpoint storage ────────────────────────────────────────────────
// Per-device { ts, sequence } checkpoints sent back on each pull so the server
// returns only NEW updates instead of re-downloading everything.

const CHECKPOINT_STORAGE_KEY = 'syncServerCheckpoints';

export function loadServerCheckpoint(noteId) {
  try {
    const raw = localStorage.getItem(`${CHECKPOINT_STORAGE_KEY}:${noteId}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveServerCheckpoint(noteId, checkpoint) {
  try {
    if (checkpoint && Object.keys(checkpoint).length > 0) {
      localStorage.setItem(`${CHECKPOINT_STORAGE_KEY}:${noteId}`, JSON.stringify(checkpoint));
    }
  } catch {
    // storage full or unavailable — non-critical
  }
}

/** Clear the stored checkpoint (e.g. after bootstrap, to force a full re-pull). */
export function clearServerCheckpoint(noteId) {
  try {
    localStorage.removeItem(`${CHECKPOINT_STORAGE_KEY}:${noteId}`);
  } catch {
    // non-critical
  }
}
