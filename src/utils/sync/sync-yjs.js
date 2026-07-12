import * as Y from 'yjs';
import { path } from '@/lib/tauri-bridge';
import {
  readDir as readSyncDir,
  readFile as readSyncFile,
  writeFile as writeSyncFile,
  removePath as removeSyncPath,
} from '@/lib/native/fs';
import {
  YJS_UPDATE_EXT,
} from './constants.js';
import { getSyncDeviceId } from './sync-repository.js';

const deviceId = getSyncDeviceId();

function yjsFileName(noteId, ts) {
  return `${noteId}-${deviceId}-${ts}${YJS_UPDATE_EXT}`;
}

/**
 * Write a single Yjs update to the shared commits/ directory.
 */
export async function writeYjsUpdate(commitsDir, noteId, update, encryptJSON) {
  const ts = Date.now();
  const payload = {
    device: deviceId,
    ts,
    noteId,
    update: Array.from(update),
  };
  const encrypted = await encryptJSON(payload, `${noteId}-${ts}`);
  const fileName = yjsFileName(noteId, ts);
  await writeSyncFile(path.join(commitsDir, fileName), encrypted);
}

/**
 * Write a full Ydoc state snapshot to the shared commits/ directory.
 * Used on first sync (commits dir empty) so new devices get the full
 * workspace without needing a separate genesis file.
 */
export async function writeYjsSnapshot(commitsDir, docId, state, encryptJSON) {
  const ts = Date.now();
  const payload = {
    device: deviceId,
    ts,
    noteId: docId,
    update: Array.from(state),
  };
  const encrypted = await encryptJSON(payload, `${docId}-snapshot-${ts}`);
  const fileName = `${docId}-snapshot-${deviceId}-${ts}${YJS_UPDATE_EXT}`;
  await writeSyncFile(path.join(commitsDir, fileName), encrypted);
}

/**
 * List Yjs update files from other devices in the commits/ directory.
 * Returns entries sorted by timestamp.
 */
export async function listRemoteYjsUpdates(commitsDir, cursors, decryptJSON) {
  let files;
  try {
    files = await readSyncDir(commitsDir);
  } catch {
    return [];
  }

  const updates = [];

  for (const file of files.filter((f) => f.endsWith(YJS_UPDATE_EXT))) {
    let payload;
    try {
      const raw = await readSyncFile(path.join(commitsDir, file));
      const noteId = file.split('-')[0];
      payload = await decryptJSON(
        raw,
        `${noteId}-${file.split('-').pop().replace(YJS_UPDATE_EXT, '')}`
      );
    } catch {
      continue;
    }
    if (!payload?.device || !payload?.noteId || !payload?.update) continue;
    if (payload.device === deviceId) continue;

    const cursorKey = `yjs-${payload.device}`;
    const seenUpTo = cursors[cursorKey] ?? 0;
    if (payload.ts <= seenUpTo) continue;

    updates.push({
      device: payload.device,
      ts: payload.ts,
      noteId: payload.noteId,
      update: new Uint8Array(payload.update),
    });
  }

  return updates.sort((a, b) => a.ts - b.ts);
}

// ─── Workspace compaction ───────────────────────────────────────────────────

const WORKSPACE_COMPACTION_THRESHOLD = 50;

/**
 * Compact all workspace .yjs.json files (incremental + old snapshots) into a
 * single full-state snapshot file.  Called from the sync loop when the number
 * of workspace files exceeds the threshold so that a new device only needs to
 * read + decrypt one file instead of potentially thousands.
 */
export async function compactWorkspaceYjs(commitsDir, decryptJSON, encryptJSON) {
  let files;
  try {
    files = await readSyncDir(commitsDir);
  } catch {
    return;
  }

  const workspaceFiles = files.filter(
    (f) => f.endsWith(YJS_UPDATE_EXT) && f.startsWith('meta')
  );

  if (workspaceFiles.length < WORKSPACE_COMPACTION_THRESHOLD) return;

  const doc = new Y.Doc();

  for (const file of workspaceFiles) {
    try {
      const raw = await readSyncFile(path.join(commitsDir, file));
      const noteId = file.split('-')[0];
      const payload = await decryptJSON(
        raw,
        `${noteId}-${file.split('-').pop().replace(YJS_UPDATE_EXT, '')}`
      );
      if (payload?.update) {
        Y.applyUpdate(doc, new Uint8Array(payload.update));
      }
    } catch {
      // skip corrupt / undecryptable files
    }
  }

  const state = Y.encodeStateAsUpdate(doc);
  await writeYjsSnapshot(commitsDir, 'meta', state, encryptJSON);

  for (const file of workspaceFiles) {
    await removeSyncPath(path.join(commitsDir, file)).catch(() => {});
  }

  doc.destroy();
}
