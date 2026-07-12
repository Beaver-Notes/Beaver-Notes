/**
 * Meta Yjs document singleton — owns the shared Y.Doc instance
 * for all workspace metadata. Kept separate to avoid circular imports
 * between useWorkspaceYjs and meta-yjs-store.
 */

import * as Y from 'yjs';

export const META_DOC_ID = 'meta';

let wsDoc = null;

export function getWorkspaceDoc() {
  if (!wsDoc) wsDoc = new Y.Doc();
  return wsDoc;
}
