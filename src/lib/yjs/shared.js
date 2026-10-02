// Shared workspace-doc registration helpers (src/lib/yjs/shared.js)
//
// Neutral shared state holder for the active Yjs document registry.
// Breaking the useNoteYjs ↔ useWsSync circular dependency.

import * as Y from 'yjs';

const activeDocs = new Map();

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

export function isPendingNoteMeta(noteId) {
  return pendingNoteMeta.has(noteId);
}

export function registerActiveDoc(noteId, doc) {
  if (doc) activeDocs.set(noteId, doc);
  else activeDocs.delete(noteId);
}

export function getActiveDoc(noteId) {
  return activeDocs.get(noteId);
}

export function unregisterActiveDoc(noteId) {
  activeDocs.delete(noteId);
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
  if (!doc) return false;
  let changed = false;
  const onUpdate = () => {
    changed = true;
  };
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
