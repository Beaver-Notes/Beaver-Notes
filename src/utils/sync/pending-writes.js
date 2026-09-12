import { writeYjsUpdate } from './sync-yjs.js';
import { encryptJSON } from './crypto.js';
import { getCurrentStateVector } from './state-vector.js';
import { isRustFolderOwner, kickRustDirty } from './rust-shim.js';

const MAX_QUEUE_SIZE = 5000;
const pendingSyncWrites = [];
let flushing = false;
let flushWaiters = [];
let cloudBuffer = null;
let syncTrigger = null;

export function setSyncTrigger(trigger) {
  syncTrigger = typeof trigger === 'function' ? trigger : null;
}

export function setCloudBuffer(buffer) {
  cloudBuffer = buffer;
}

export function getCloudBuffer() {
  return cloudBuffer;
}

export function hasPendingWrites() {
  return pendingSyncWrites.length > 0;
}

function drainPending() {
  return pendingSyncWrites.splice(0).map((w) => ({
    commitsDir: w.commitsDir,
    noteId: w.noteId,
    update: new Uint8Array(w.update),
  }));
}

function waitForFlush(callback) {
  if (!flushing) return callback();
  return new Promise((resolve, reject) => {
    flushWaiters.push({ resolve, reject, callback });
  });
}

function settleWaiters(err) {
  const waiters = flushWaiters;
  flushWaiters = [];
  for (const w of waiters) {
    if (err) {
      w.reject(err);
      continue;
    }
    Promise.resolve()
      .then(() => w.callback())
      .then(w.resolve, w.reject);
  }
}

export function clearPendingWrites() {
  pendingSyncWrites.length = 0;
}

export function queueSyncWrite(commitsDir, noteId, update) {
  if (pendingSyncWrites.length >= MAX_QUEUE_SIZE) return false;
  pendingSyncWrites.push({ commitsDir, noteId, update: new Uint8Array(update) });
  if (isRustFolderOwner()) kickRustDirty();
  if (typeof syncTrigger === 'function') syncTrigger();
  return true;
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
      const failed = [];
      for (const { commitsDir, noteId, update } of entries) {
        try {
          const sv = await getCurrentStateVector(noteId);
          await writeYjsUpdate(commitsDir, noteId, update, encryptJSON, sv);
        } catch {
          failed.push({ commitsDir, noteId, update });
          break;
        }
      }
      if (failed.length > 0) {
        const remainingIndex = entries.findIndex(
          (e) => e.noteId === failed[0].noteId && e.commitsDir === failed[0].commitsDir
        );
        const unprocessed = entries.slice(remainingIndex).map((e) => ({
          commitsDir: e.commitsDir,
          noteId: e.noteId,
          update: new Uint8Array(e.update),
        }));
        pendingSyncWrites.unshift(...unprocessed);
        break;
      }
    }
  } finally {
    flushing = false;
    settleWaiters();
  }
}
