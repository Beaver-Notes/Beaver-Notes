/**
 * Pending-sync-update queue.
 *
 * Instead of writing a sync-folder file on every 300 ms debounced flush (which
 * generates ~200 files/minute of active typing), local edits are queued here
 * and flushed to the sync folder during the next sync cycle.  The queue is
 * drained atomically: a crashed session may lose up to 10 s of sync writes
 * (still present in SQLite), but the steady-state write rate drops to one
 * sync cycle's worth of merged updates.
 */

import { writeYjsUpdate } from './sync-yjs.js';
import { encryptJSON } from './crypto.js';

const MAX_QUEUE_SIZE = 5000;
const pendingSyncWrites = [];
let flushing = false;
let cloudBuffer = null;
let syncTrigger = null;

export function setSyncTrigger(trigger) {
  syncTrigger = typeof trigger === 'function' ? trigger : null;
}

/**
 * Set the cloud transport's in-memory buffer for cloud-only mode.
 * When set, flushPendingSyncWrites skips disk writes and buffers here instead.
 */
export function setCloudBuffer(buffer) {
  cloudBuffer = buffer;
}

export function getCloudBuffer() {
  return cloudBuffer;
}

/**
 * Check whether there are queued writes waiting to be flushed.
 */
export function hasPendingWrites() {
  return pendingSyncWrites.length > 0;
}

/**
 * @callback WriteFn
 * @param {string} noteId
 * @param {Uint8Array} update
 * @returns {Promise<void>}
 */

/**
 * Drain pending writes into an array of {commitsDir, noteId, update} entries.
 * Does NOT touch cloudBuffer — callers handle that themselves.
 */
function drainPending() {
  return pendingSyncWrites.splice(0).map((w) => ({
    commitsDir: w.commitsDir,
    noteId: w.noteId,
    update: new Uint8Array(w.update),
  }));
}

/**
 * Wait for an in-progress flush to finish, then run a callback.
 * Returns a promise that resolves with the callback's result.
 */
function waitForFlush(callback) {
  return new Promise((resolve) => {
    const check = async () => {
      if (flushing) { setTimeout(check, 50); return; }
      resolve(await callback());
    };
    check();
  });
}

/**
 * Flush pending writes using the provided write function.
 * Returns the list of flushed entries for downstream consumers (e.g. remote push).
 * @param {WriteFn} writeFn - called for each entry with (noteId, update)
 * @returns {Promise<Array<{noteId: string, update: Uint8Array}>>}
 */
export async function flushPendingSyncWritesTo(writeFn) {
  if (flushing) {
    return waitForFlush(() => flushPendingSyncWritesTo(writeFn));
  }
  flushing = true;
  const flushed = [];
  try {
    while (pendingSyncWrites.length > 0) {
      const entries = drainPending();
      for (const { noteId, update } of entries) {
        try {
          await writeFn(noteId, update);
          flushed.push({ noteId, update });
        } catch (err) {
          console.warn('[sync] failed to flush pending write for', noteId, err);
        }
      }
    }
  } finally {
    flushing = false;
  }
  return flushed;
}

export function queueSyncWrite(commitsDir, noteId, update) {
  if (pendingSyncWrites.length >= MAX_QUEUE_SIZE) {
    console.warn('[sync] pending writes queue full, dropping oldest entries');
    pendingSyncWrites.splice(0, pendingSyncWrites.length - MAX_QUEUE_SIZE + 100);
  }
  pendingSyncWrites.push({ commitsDir, noteId, update: new Uint8Array(update) });
  syncTrigger?.();
}

export async function flushPendingSyncWrites() {
  if (flushing) {
    return waitForFlush(() => flushPendingSyncWrites());
  }
  flushing = true;
  try {
    while (pendingSyncWrites.length > 0) {
      // Cloud-only mode: buffer in memory instead of writing to disk
      if (cloudBuffer) {
        const batch = pendingSyncWrites.splice(0);
        for (const w of batch) {
          cloudBuffer.push({ noteId: w.noteId, update: new Uint8Array(w.update) });
        }
        continue;
      }

      const entries = drainPending();
      for (const { commitsDir, noteId, update } of entries) {
        try {
          await writeYjsUpdate(commitsDir, noteId, update, encryptJSON);
        } catch (err) {
          console.warn('[sync] failed to flush pending write for', noteId, err);
        }
      }
    }
  } finally {
    flushing = false;
  }
}
