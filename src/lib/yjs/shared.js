// Shared workspace-doc registration helpers (src/lib/yjs/shared.js)
//
// Neutral shared state holder for the active Yjs document registry.
// Breaking the useNoteYjs ↔ useWsSync circular dependency.

import * as Y from 'yjs';

const activeDocs = new Map();

// Remote updates that arrived for a noteId with no registered doc. Buffering
// them keeps a pulled snapshot from being discarded: `useNoteYjs` registers a
// doc at the end of an awaited `load()` but unregisters in `onUnmounted` after
// its own awaited flush, so a late unmount deletes the entry a freshly mounted
// page just registered and every later pull became a silent no-op. Anything
// buffered here is replayed into the doc the moment it registers.
//
// Rejected alternative: the batch-wide `collect::<Result<..>>()?` decrypt in
// src-tauri/src/db.rs. That failure reaches the per-note fallback in
// rust-shim.js, which already logs, so it cannot produce the silent no-op.
//
// The buffer is keyed by note id only, never by doc, and `unregisterActiveDoc`
// deliberately leaves it alone: an update that lands after the editor for a note
// is torn down must wait for the next doc registered under that id instead of
// dying with the old one.
//
// ponytail: capped queue, oldest dropped. Fine while a pull buffer only grows
// for notes nobody opens; unbounded map if the same note is pulled at forever
// without ever being opened.
const MAX_PENDING_REMOTE = 8;
const pendingRemote = new Map();
const missingDocLogged = new Set();

// Notes whose meta write is still in flight (store.add before syncNoteMeta).
// The workspace observer must not evict them as "deleted" while they are being
// created; the doc has no `notes` entry for them yet.
const pendingNoteMeta = new Set();

export function markPendingNoteMeta(noteId) {
  if (noteId) pendingNoteMeta.add(noteId);
}

export function clearPendingNoteMeta(noteId) {
  pendingNoteMeta.delete(noteId);
}

/** A workspace switch invalidates every pending meta mark: they name notes of the doc that just closed. */
export function clearAllPendingNoteMeta() {
  pendingNoteMeta.clear();
}

export function isPendingNoteMeta(noteId) {
  return pendingNoteMeta.has(noteId);
}

export function registerActiveDoc(noteId, doc) {
  if (doc) {
    activeDocs.set(noteId, doc);
    replayPendingRemote(noteId, doc);
  } else activeDocs.delete(noteId);
}

export function getActiveDoc(noteId) {
  return activeDocs.get(noteId);
}

export function unregisterActiveDoc(noteId) {
  activeDocs.delete(noteId);
}

// SC-1-05: the buffer holds decrypted note content, so it must not outlive
// the account. Sign-out/teardown clears it; in-flight registration replays
// are torn down with the docs they belong to.
export function clearPendingRemote() {
  pendingRemote.clear();
  missingDocLogged.clear();
}

// Notified after a remote update actually changed an active doc. Used by the
// note page to surface the "merged changes — review" banner. Listeners are
// intentionally not called for idempotent replays (Yjs only emits `update`
// when the transaction produced new content, including delete-set changes).
const remoteAppliedListeners = new Set();

export function onRemoteApplied(listener) {
  remoteAppliedListeners.add(listener);
  return () => remoteAppliedListeners.delete(listener);
}

export function applyRemote(noteId, update) {
  const doc = getActiveDoc(noteId);
  if (!doc) {
    let queued = pendingRemote.get(noteId);
    if (!queued) pendingRemote.set(noteId, (queued = []));
    queued.push(update);
    if (queued.length > MAX_PENDING_REMOTE) {
      queued.shift();
      console.warn(
        `[yjs] pending remote buffer for ${noteId} exceeded ${MAX_PENDING_REMOTE}, dropping oldest update`,
      );
    }
    if (!missingDocLogged.has(noteId)) {
      missingDocLogged.add(noteId);
      console.warn('[yjs] remote update for a note with no active doc, buffered:', noteId);
    }
    return false;
  }
  return applyToDoc(noteId, doc, update);
}

// Content-loss guard for remote batches: a pull that would erase the
// overwhelming majority of a large document's content is treated as server
// state corruption, not collaboration (observed: a broken metadata-only
// server answering pulls with a destructive state). Large docs dry-run the
// batch against a clone of the current state and refuse collapses; small
// docs skip the guard (cheap to rebuild, low stakes). Fails open: a guard
// error never blocks sync.
const GUARD_MIN_NODES = 300;
const GUARD_KEEP_RATIO = 0.2;

function dryRunContentLength(doc, update) {
  const dry = new Y.Doc();
  try {
    Y.applyUpdate(dry, Y.encodeStateAsUpdate(doc), 'sync');
    Y.applyUpdate(dry, update, 'sync');
    return dry.getXmlFragment('content').length;
  } finally {
    dry.destroy();
  }
}

function applyToDoc(noteId, doc, update) {
  let changed = false;
  const onUpdate = () => {
    changed = true;
  };
  const beforeNodes = doc.getXmlFragment('content').length;
  if (beforeNodes >= GUARD_MIN_NODES) {
    let afterNodes = beforeNodes;
    try {
      afterNodes = dryRunContentLength(doc, update);
    } catch (err) {
      console.warn('[yjs] content-loss guard could not dry-run, applying anyway:', err?.message);
    }
    if (afterNodes * (1 / GUARD_KEEP_RATIO) < beforeNodes) {
      console.error(
        `[yjs] DESTRUCTIVE remote update refused for ${noteId}: content ${beforeNodes} -> ${afterNodes} nodes`,
      );
      return false;
    }
  }
  doc.on('update', onUpdate);
  try {
    doc.transact(() => {
      Y.applyUpdate(doc, update);
    }, 'sync');
  } finally {
    doc.off('update', onUpdate);
  }
  if (changed) {
    for (const listener of remoteAppliedListeners) {
      try {
        listener(noteId);
      } catch {
        // A bad listener must never break applying a remote update.
      }
    }
  }
  return true;
}

function replayPendingRemote(noteId, doc) {
  const queued = pendingRemote.get(noteId);
  if (!queued?.length) return;
  pendingRemote.delete(noteId);
  missingDocLogged.delete(noteId);
  for (const update of queued) applyToDoc(noteId, doc, update);
}
