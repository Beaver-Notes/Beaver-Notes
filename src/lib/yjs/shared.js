// Shared workspace-doc registration helpers (src/lib/yjs/shared.js)
//
// Neutral shared state holder for the active Yjs document registry.
// Breaking the useNoteYjs ↔ useHocuspocusSync circular dependency.

import * as Y from 'yjs';

const activeDocs = new Map();

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

export function applyRemote(noteId, update) {
  const doc = getActiveDoc(noteId);
  if (!doc) return false;
  doc.transact(() => {
    Y.applyUpdate(doc, update);
  }, 'sync');
  return true;
}
