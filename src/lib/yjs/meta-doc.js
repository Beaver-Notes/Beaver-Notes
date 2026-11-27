/** Workspace Y.Doc singleton for metadata. Separate to avoid circular imports. */

import * as Y from 'yjs';

export const META_DOC_ID = 'meta';

let wsDoc = null;
let _onCreate = null;

/** Register a callback that runs for every freshly created doc (attach handlers). */
export function onWorkspaceDocCreate(cb) {
  _onCreate = cb;
}

export function getWorkspaceDoc() {
  if (!wsDoc) {
    const created = new Y.Doc();
    wsDoc = created;
    if (_onCreate) {
      try {
        _onCreate(created);
      } catch {
        // Attaching handlers must never block doc creation.
      }
    }
  }
  return wsDoc;
}

/** Destroy singleton, release resources. Required for account/switch to avoid stale observers. Next get creates fresh doc. */
export function destroyWorkspaceDoc() {
  const doc = wsDoc;
  if (!doc) return;
  wsDoc = null;
  doc.destroy();
}
