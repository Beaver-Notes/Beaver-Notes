/**
 * Pending-sync-update queue: local edits are queued and flushed once per sync
 * cycle instead of writing a file per 300ms debounced flush (~200 files/min
 * while typing). Drained atomically — a crashed session may lose up to 10s of
 * sync writes (still present in SQLite).
 */

import { writeYjsUpdate } from './sync-yjs.js';
import { encryptJSON } from './crypto.js';
import { getCurrentStateVector } from './state-vector.js';

const MAX_QUEUE_SIZE = 5000;
const pendingSyncWrites = [];
let flushing = false;
let cloudBuffer = null;
let syncTrigger = null;

export function setSyncTrigger(trigger) {
  syncTrigger = typeof trigger === 'function' ? trigger : null;
}

/** Cloud-only mode: when set, flush buffers in memory instead of writing disk. */
export function setCloudBuffer(buffer) {
  cloudBuffer = buffer;
}

export function getCloudBuffer() {
  return cloudBuffer;
}

export function hasPendingWrites() {
  return pendingSyncWrites.length > 0;
}

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

function waitForFlush(callback) {
  return new Promise((resolve) => {
    const check = async () => {
      if (flushing) { setTimeout(check, 50); return; }
      resolve(await callback());
    };
    check();
  });
}

/** Flush via writeFn; returns flushed entries for downstream consumers (e.g. remote push). */
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

/** Discard pending writes after vault key adoption — they were encrypted with the pre-adoption key. */
export function clearPendingWrites() {
  pendingSyncWrites.length = 0;
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
          const sv = await getCurrentStateVector(noteId);
          await writeYjsUpdate(commitsDir, noteId, update, encryptJSON, sv);
        } catch (err) {
          console.warn('[sync] failed to flush pending write for', noteId, err);
        }
      }
    }
  } finally {
    flushing = false;
  }
}
