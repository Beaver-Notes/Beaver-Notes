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
 * Flush pending writes using the provided write function.
 * Returns the list of flushed entries for downstream consumers (e.g. remote push).
 * @param {WriteFn} writeFn - called for each entry with (noteId, update)
 * @returns {Promise<Array<{noteId: string, update: Uint8Array}>>}
 */
export async function flushPendingSyncWritesTo(writeFn) {
  if (flushing) return [];
  flushing = true;
  const flushed = [];
  try {
    while (pendingSyncWrites.length > 0) {
      const batch = pendingSyncWrites.splice(0);
      const byDir = new Map();
      for (const w of batch) {
        if (!byDir.has(w.commitsDir)) byDir.set(w.commitsDir, []);
        byDir.get(w.commitsDir).push({ noteId: w.noteId, update: new Uint8Array(w.update) });
      }
      for (const [, entries] of byDir) {
        for (const { noteId, update } of entries) {
          try {
            await writeFn(noteId, update);
            flushed.push({ noteId, update });
          } catch (err) {
            console.warn('[sync] failed to flush pending write for', noteId, err);
          }
        }
      }
    }
  } finally {
    flushing = false;
  }
  return flushed;
}

export function queueSyncWrite(commitsDir, noteId, update) {
  pendingSyncWrites.push({ commitsDir, noteId, update: new Uint8Array(update) });
  syncTrigger?.();
}

export async function flushPendingSyncWrites() {
  if (flushing) return;
  flushing = true;
  try {
    while (pendingSyncWrites.length > 0) {
      const batch = pendingSyncWrites.splice(0);

      // Cloud-only mode: buffer in memory instead of writing to disk
      if (cloudBuffer) {
        for (const w of batch) {
          cloudBuffer.push({ noteId: w.noteId, update: new Uint8Array(w.update) });
        }
        continue;
      }

      // Folder sync mode: write encrypted files to commits directory
      const byDir = new Map();
      for (const w of batch) {
        if (!byDir.has(w.commitsDir)) byDir.set(w.commitsDir, []);
        byDir.get(w.commitsDir).push({ noteId: w.noteId, update: new Uint8Array(w.update) });
      }
      for (const [dir, entries] of byDir) {
        for (const { noteId, update } of entries) {
          try {
            await writeYjsUpdate(dir, noteId, update, encryptJSON);
          } catch (err) {
            console.warn('[sync] failed to flush pending write for', noteId, err);
          }
        }
      }
    }
  } finally {
    flushing = false;
  }
}
