/**
 * Debug bridge — ground-truth introspection of the migration/workspace layers.
 *
 * Exposes `dumpDebugState()` for the console (and the app-shell startup path
 * behind a flag) that correlates:
 *
 *   1. what the NATIVE side actually persisted — KV rows, per-note Yjs
 *      updates, and the decoded workspace meta doc (`debug:dump-state`),
 *   2. what the FRONTEND has in memory — the workspace Y.Doc and the Pinia
 *      note/folder/label stores.
 *
 * The classic "labels visible, notes/folders missing" empty-state is almost
 * always a mismatch between these two layers (e.g. the workspace doc was
 * seeded from KV under stale keys). This bridge makes that mismatch visible in
 * one place instead of guessing.
 *
 * Usage from the console:
 *   window.__beaverDebug?.()
 */

import { backend } from '@/lib/tauri-bridge';
import { useStorage } from '@/lib/storage';

const storage = useStorage();

let hooked = false;

function subscribeHooks() {
  if (hooked) return;
  hooked = true;
  if (typeof window === 'undefined') return;
  window.__beaverDebug = () => {
    dumpDebugState().catch((err) => {
      console.warn('[debug-bridge] dump failed:', err);
    });
  };
}

/** Raw persisted state straight from the native side. */
export async function dumpNativeState() {
  const raw = await backend.invoke('debug:dump-state');
  console.warn('[debug-bridge] native persisted state:', JSON.stringify(raw, null, 2));
  return raw;
}

/**
 * Frontend-side state: what the live workspace Y.Doc and the Pinia stores
 * currently hold. This is the layer the UI actually renders from.
 */
export async function dumpFrontendState() {
  const notesStore = (await import('@/store/note')).useNoteStore();
  const folderStore = (await import('@/store/folder')).useFolderStore();
  const labelStore = (await import('@/store/label')).useLabelStore();
  const { getWorkspaceDoc } = await import('@/lib/yjs/meta-doc.js');

  const doc = getWorkspaceDoc();
  const yNotes = doc.getMap('notes');
  const yFolders = doc.getMap('folders');
  const yLabels = doc.getArray('labels');
  const yLabelColors = doc.getMap('labelColors');

  const sampleNotes = [];
  for (const [key, yNote] of yNotes.entries()) {
    if (sampleNotes.length >= 5) break;
    sampleNotes.push({
      key,
      id: yNote.get('id'),
      title: yNote.get('title'),
    });
  }

  const kvNotes = await storage.get('notes', {});
  const kvLabels = await storage.get('labels', []);
  const kvFolders = await storage.get('folders', {});

  const state = {
    workspaceDoc: {
      notes: yNotes.size,
      folders: yFolders.size,
      labels: yLabels.toArray(),
      labelColors: yLabelColors.size,
      sampleNotes,
    },
    stores: {
      notes: Object.values(notesStore.data).filter((n) => n?.id).length,
      folders: Object.values(folderStore.data).filter((f) => f?.id).length,
      labels: labelStore.data.length,
    },
    kv: {
      notes: Object.keys(kvNotes || {}).length,
      folders: Object.keys(kvFolders || {}).length,
      labels: (kvLabels || []).length,
      sampleNoteIds: Object.keys(kvNotes || {}).slice(0, 5),
    },
  };

  console.warn('[debug-bridge] frontend in-memory state:', JSON.stringify(state, null, 2));
  return state;
}

/**
 * Full correlated dump. Call this after a migration (or from the startup path)
 * to see where notes got stranded.
 */
export async function dumpDebugState() {
  const native = await dumpNativeState();
  const frontend = await dumpFrontendState();
  console.warn('[debug-bridge] SUMMARY', {
    native: {
      kvNotes: native.dataStore?.notes,
      kvFolders: native.dataStore?.folders,
      workspaceNotes: native.workspaceDoc?.notes,
      workspaceFolders: native.workspaceDoc?.folders,
      workspaceLabels: native.workspaceDoc?.labels,
      settingsFlags: native.settingsFlags,
    },
    frontend: {
      storeNotes: frontend.stores.notes,
      storeFolders: frontend.stores.folders,
      storeLabels: frontend.stores.labels,
      workspaceNotes: frontend.workspaceDoc.notes,
    },
  });
  return { native, frontend };
}

subscribeHooks();
