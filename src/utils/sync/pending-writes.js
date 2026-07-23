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

const pendingSyncWrites = [];
let flushing = false;

export function queueSyncWrite(commitsDir, noteId, update) {
  pendingSyncWrites.push({ commitsDir, noteId, update: Array.from(update) });
}

export async function flushPendingSyncWrites() {
  if (flushing) return;
  flushing = true;
  try {
    while (pendingSyncWrites.length > 0) {
      const batch = pendingSyncWrites.splice(0);
      // Group by commitsDir for efficient writing
      const byDir = new Map();
      for (const w of batch) {
        if (!byDir.has(w.commitsDir)) byDir.set(w.commitsDir, []);
        byDir.get(w.commitsDir).push({ noteId: w.noteId, update: new Uint8Array(w.update) });
      }
      for (const [dir, entries] of byDir) {
        const { writeYjsUpdate } = await import('./sync-yjs.js');
        const { encryptJSON } = await import('./crypto.js');
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
