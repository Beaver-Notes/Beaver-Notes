/** Workspace Y.Doc singleton for metadata. Separate to avoid circular imports. */

import * as Y from 'yjs';

export const META_DOC_ID = 'meta';

let wsDoc = null;
let _onDestroy = null;

export function getWorkspaceDoc() {
  if (!wsDoc) wsDoc = new Y.Doc();
  return wsDoc;
}

/** Register callback on workspace doc destroy (resets observer flags). */
export function onWorkspaceDocDestroy(cb) {
  _onDestroy = cb;
}

/** Destroy singleton, release resources. Required for account/switch to avoid stale observers. Next get creates fresh doc. */
export function destroyWorkspaceDoc() {
  if (wsDoc) {
    wsDoc.destroy();
    wsDoc = null;
    if (_onDestroy) { _onDestroy(); _onDestroy = null; }
  }
}
