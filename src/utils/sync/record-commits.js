import { captureNoteSnapshot, captureNoteSnapshotFromBytes } from './commit-snapshot.js';
import { getSnapshot } from '@/lib/native/yjs.js';
import { toUint8Array } from '@/lib/yjs/helpers.js';
import { createCommit } from '@/lib/api/history.js';
import { logger } from '@/utils/logger';

const MAX_NOTES = 30;
const CONCURRENCY = 4;
// Durable pushes fire for merge/echo/pull cycles too, not just edits, and the
// same content can be captured from the live doc or from stored bytes with a
// paragraph more or less. Keep a few fingerprints per note and persist them:
// an in-memory single value let every app launch append a no-op history entry
// and let the two capture paths alternate. Values are SHA-256 digests of
// `title\Ncontent`, never the text itself: localStorage is plaintext.
const FINGERPRINTS_KEY = 'beaver:history-commit-fingerprints';
const FINGERPRINTS_PER_NOTE = 4;

const inFlight = new Set();
const lastCommitted = loadFingerprints();

function loadFingerprints() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FINGERPRINTS_KEY) || '{}');
    return new Map(
      Object.entries(parsed).map(([noteId, prints]) => [
        noteId,
        Array.isArray(prints) ? prints : [prints],
      ]),
    );
  } catch {
    return new Map();
  }
}

function rememberFingerprint(noteId, fingerprint) {
  lastCommitted.set(
    noteId,
    [fingerprint, ...(lastCommitted.get(noteId) || [])].slice(0, FINGERPRINTS_PER_NOTE),
  );
  // Map keeps insertion order, so the oldest notes fall off first.
  if (lastCommitted.size > 512) {
    for (const key of [...lastCommitted.keys()].slice(0, 256)) lastCommitted.delete(key);
  }
  try {
    localStorage.setItem(FINGERPRINTS_KEY, JSON.stringify(Object.fromEntries(lastCommitted)));
  } catch {
    /* Privacy mode or quota: the in-memory list still covers this session. */
  }
}

/// Test seam: the cache persists across cases in one module graph, so a spec
/// that reuses a note id would see its second push silently skipped.
export function _resetCommitCache() {
  lastCommitted.clear();
  try {
    localStorage.removeItem(FINGERPRINTS_KEY);
  } catch {
    /* No storage in this environment. */
  }
}

async function fingerprintOf(title, content) {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${title ?? ''}\n${content ?? ''}`),
  );
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

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
      const fingerprint = await fingerprintOf(snapshot.title, snapshot.content);
      if ((lastCommitted.get(noteId) || []).includes(fingerprint)) continue;
      await createCommit(noteId, snapshot);
      rememberFingerprint(noteId, fingerprint);
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
