// src/utils/sync/transports/seed.js

import * as Y from 'yjs';
import { getWorkspaceDoc, META_DOC_ID } from '@/lib/yjs/meta-doc.js';
import { writeYjsSnapshot } from '../sync-yjs.js';
import { encryptJSON } from '../crypto.js';
import { toUint8Array, applyUpdatesToDoc } from '@/utils/yjs-helpers.js';
import { getSnapshot, getUpdates } from '@/lib/native/yjs.js';

export async function writeInitialSnapshots(commitsDir) {
  const workspaceDoc = getWorkspaceDoc();

  const wsState = Y.encodeStateAsUpdate(workspaceDoc);
  await writeYjsSnapshot(commitsDir, META_DOC_ID, wsState, encryptJSON);

  const notesMap = workspaceDoc.getMap('notes');
  const VALID_NOTE_ID_RE = /^[a-zA-Z0-9_-]{1,256}$/;
  const noteIds = Array.from(notesMap.keys()).filter(
    (id) => typeof id === 'string' && id.trim().length > 0 && id !== 'undefined'
      && VALID_NOTE_ID_RE.test(id)
  );

  await Promise.all(
    noteIds.map(async (noteId) => {
      const doc = new Y.Doc();
      try {
        let loaded = false;
        try {
          const snapshot = await getSnapshot(noteId);
          if (snapshot && snapshot.length > 0) {
            Y.applyUpdate(doc, toUint8Array(snapshot));
            loaded = true;
          }
        } catch {
          // fall back to updates
        }
        if (!loaded) {
          try {
            const updates = await getUpdates(noteId);
            applyUpdatesToDoc(doc, updates);
          } catch {
            // skip this note
          }
        }
        const state = Y.encodeStateAsUpdate(doc);
        if (state.byteLength > 0) {
          await writeYjsSnapshot(commitsDir, noteId, state, encryptJSON);
        }
      } catch (err) {
        console.warn('[sync] initial snapshot failed for', noteId, err);
      } finally {
        doc.destroy();
      }
    })
  );
}
