/** Per-note state vector: JSON map deviceId to clock from y-octo. Not binary: y-octo uses string IDs, yjs numeric. */

import { getStateVector } from '@/lib/native/yjs.js';

const STORAGE_KEY = 'syncStateVectors';

export function loadStateVector(docId) {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${docId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const clean = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === 'string' && k.length > 0 && Number.isInteger(v) && v >= 0) clean[k] = v;
    }
    return clean;
  } catch {
    return null;
  }
}

export function saveStateVector(docId, sv) {
  try {
    localStorage.setItem(`${STORAGE_KEY}:${docId}`, JSON.stringify(sv));
  } catch {
    // Storage full or unavailable: non-critical.
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

// Per-device { ts, sequence } checkpoints sent back on each pull so the server
// returns only NEW updates instead of re-downloading everything.

const CHECKPOINT_STORAGE_KEY = 'syncServerCheckpoints';

export function loadServerCheckpoint(noteId) {
  try {
    const raw = localStorage.getItem(`${CHECKPOINT_STORAGE_KEY}:${noteId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
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
    // Storage full or unavailable: non-critical.
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
