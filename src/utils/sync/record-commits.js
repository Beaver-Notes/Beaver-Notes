import { captureNoteSnapshot, captureNoteSnapshotFromBytes } from './commit-snapshot.js';
import { getSnapshot } from '@/lib/native/yjs.js';
import { toUint8Array } from '@/lib/yjs/helpers.js';
import { createCommit } from '@/lib/api/history.js';
import { logger } from '@/utils/logger';

const MAX_NOTES = 30;
const CONCURRENCY = 4;

const inFlight = new Set();
// Durable pushes fire for merge/echo/pull cycles too, not just edits; without
// a content filter every such cycle records a history commit whose title and
// content are identical to the previous one ("no actual changes" entries).
const lastCommitted = new Map();

async function runWorker(queue) {
  while (queue.length) {
    const noteId = queue.shift();
    try {
      let snapshot = await captureNoteSnapshot(noteId);
      if (!snapshot) {
        // Note is closed (no active Y.Doc): build history from the stored
        // snapshot bytes so background edits get commits too.
        const bytes = await getSnapshot(noteId);
        if (bytes && bytes.length > 0) {
          snapshot = await captureNoteSnapshotFromBytes(noteId, toUint8Array(bytes));
        }
      }
      if (!snapshot) continue;
      const fingerprint = `${snapshot.title ?? ''}\n${snapshot.content ?? ''}`;
      if (lastCommitted.get(noteId) === fingerprint) continue;
      await createCommit(noteId, snapshot);
      lastCommitted.set(noteId, fingerprint);
      if (lastCommitted.size > 512) lastCommitted.clear();
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
