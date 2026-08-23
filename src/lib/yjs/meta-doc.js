/**
 * Meta Yjs document singleton — owns the shared Y.Doc instance
 * for all workspace metadata. Kept separate to avoid circular imports
 * between the workspace doc and the meta store.
 */

import * as Y from 'yjs';

export const META_DOC_ID = 'meta';

let wsDoc = null;
let _onDestroy = null;

export function getWorkspaceDoc() {
  if (!wsDoc) wsDoc = new Y.Doc();
  return wsDoc;
}

/**
 * Register a callback to run when the workspace doc is destroyed.
 * Used by workspace-doc.js to reset observer/persist flags.
 */
export function onWorkspaceDocDestroy(cb) {
  _onDestroy = cb;
}

/**
 * Destroy the workspace doc singleton and release all resources.
 * Required for account/workspace switches to avoid stale observers
 * and memory leaks. The next getWorkspaceDoc() call creates a fresh doc.
 */
export function destroyWorkspaceDoc() {
  if (wsDoc) {
    wsDoc.destroy();
    wsDoc = null;
    if (_onDestroy) { _onDestroy(); _onDestroy = null; }
  }
}
