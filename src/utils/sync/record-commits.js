import { captureNoteSnapshot } from './commit-snapshot.js';
import { createCommit } from '@/lib/api/history.js';
import { logger } from '@/utils/logger';

const MAX_NOTES = 30;
const CONCURRENCY = 4;

const inFlight = new Set();

async function runWorker(queue) {
  while (queue.length) {
    const noteId = queue.shift();
    try {
      const snapshot = await captureNoteSnapshot(noteId);
      if (!snapshot) continue;
      await createCommit(noteId, snapshot);
    } catch (err) {
      logger.warn(`[sync] failed to record history commit for ${noteId}:`, err?.message);
    }
  }
}

/** Record version-history commits for notes Rust pushed. Fire-and-forget; never rejects. */
export async function recordPushedCommits(noteIds) {
  const ids = [...new Set(noteIds || [])]
    .filter((id) => id && !inFlight.has(id))
    .slice(0, MAX_NOTES);
  if (!ids.length) return;

  for (const id of ids) inFlight.add(id);
  try {
    const queue = ids.slice();
    const workers = Array.from(
      { length: Math.min(CONCURRENCY, queue.length) },
      () => runWorker(queue),
    );
    await Promise.all(workers);
  } finally {
    for (const id of ids) inFlight.delete(id);
  }
}
