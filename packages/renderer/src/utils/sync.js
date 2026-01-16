import { toRaw } from 'vue';
import { useStorage } from '@/composable/storage';
import { useNoteStore } from '@/store/note.js';
import { useFolderStore } from '@/store/folder.js';

const { ipcRenderer, path } = window.electron;
const storage = useStorage();

let deviceId =
  localStorage.getItem('deviceId') ||
  (() => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem('deviceId', id);
    return id;
  })();

const state = { syncing: false };
let syncQueue = Promise.resolve(); // ensures sequential syncs

// ============================================================================
// PUBLIC API
// ============================================================================

export async function trackChange(key, data) {
  if (localStorage.getItem('autoSync') !== 'true') return;

  const [type, id] = key.split('.');
  const commit = {
    id: `${Date.now()}-${deviceId}`,
    parent: await storage.get('lastCommitId', '', 'settings'),
    device: deviceId,
    ts: Date.now(),
    ops: [
      {
        type,
        id: id || type,
        data: data ? JSON.parse(JSON.stringify(toRaw(data))) : null,
      },
    ],
  };
  // Save commit immediately to local commits folder
  const commitsDir = await getCommitsDir();
  await ipcRenderer.callMain('fs:output-json', {
    path: path.join(commitsDir, `${commit.id}.json`),
    data: commit,
  });

  await storage.set('lastCommitId', commit.id, 'settings');

  enqueueSync();
}

export function forceSyncNow() {
  return enqueueSync(true);
}

export async function getSyncStatus() {
  const lastCommitId = await storage.get('lastCommitId', '', 'settings');
  return { syncing: state.syncing, lastCommitId };
}

export async function initFromSnapshot() {
  const snapshotPath = await getSnapshotPath();
  if (!snapshotPath) return;

  try {
    const snap = await ipcRenderer.callMain('fs:read-json', snapshotPath);
    await storage.set('notes', snap.data.notes);
    await storage.set('folders', snap.data.folders);
    await storage.set('labels', snap.data.labels);
    await storage.set('deletedIds', snap.data.deletedIds || {});
    await storage.set('deletedFolderIds', snap.data.deletedFolderIds || {});
  } catch {
    console.log('No snapshot found. Will build state from commits.');
  }
}

// ============================================================================
// QUEUED SYNC
// ============================================================================

function enqueueSync(force = false) {
  syncQueue = syncQueue.then(
    () => sync(force),
    () => sync(force)
  );
  return syncQueue;
}

// ============================================================================
// SYNC CORE
// ============================================================================

async function sync(force = false) {
  if (state.syncing && !force) return;
  const syncPath = localStorage.getItem('default-path');
  if (!syncPath) return;

  state.syncing = true;

  try {
    const syncDir = path.join(syncPath, 'BeaverNotesSync');
    const commitsDir = path.join(syncDir, 'commits');
    await ipcRenderer.callMain('fs:ensureDir', commitsDir);

    // Pull remote commits
    const localLastId = await storage.get('lastCommitId', '', 'settings');
    const remoteCommits = await getRemoteCommits(commitsDir, localLastId);

    // Apply all commits
    for (const commit of remoteCommits) {
      for (const op of commit.ops) await applyOp(op);
      await storage.set('lastCommitId', commit.id, 'settings');
    }

    // Sync assets
    const localDir = await storage.get('dataDir', '', 'settings');
    await syncAssets(localDir, syncDir);

    // Optional: compact if too many commits
    const allFiles = await ipcRenderer.callMain('fs:readdir', commitsDir);
    if (allFiles.length > 200) await compact(syncDir, commitsDir);

    // Refresh stores
    await Promise.all([useNoteStore().retrieve(), useFolderStore().retrieve()]);
  } catch (err) {
    console.error('Sync failed:', err);
  } finally {
    state.syncing = false;
  }
}

// ============================================================================
// HELPERS
// ============================================================================

async function getCommitsDir() {
  const syncPath = localStorage.getItem('default-path');
  if (!syncPath) return;
  const commitsDir = path.join(syncPath, 'BeaverNotesSync', 'commits');
  await ipcRenderer.callMain('fs:ensureDir', commitsDir);
  return commitsDir;
}

async function getSnapshotPath() {
  const syncPath = localStorage.getItem('default-path');
  if (!syncPath) return null;
  return path.join(syncPath, 'BeaverNotesSync', 'snapshot.json');
}

async function getRemoteCommits(commitsDir, lastSeen) {
  const files = await ipcRenderer
    .callMain('fs:readdir', commitsDir)
    .catch(() => []);
  const commits = [];

  for (const file of files.filter((f) => f.endsWith('.json'))) {
    const commit = await ipcRenderer.callMain(
      'fs:read-json',
      path.join(commitsDir, file)
    );
    if (commit.device === deviceId || (lastSeen && commit.id <= lastSeen))
      continue;
    commits.push(commit);
  }

  return commits.sort((a, b) => a.ts - b.ts);
}

async function applyOp(op) {
  const { type, id, data } = op;

  if (type === 'notes') {
    const notes = await storage.get('notes', {});
    if (!data) delete notes[id];
    else {
      const existing = notes[id];
      if (!existing || data.updatedAt > existing.updatedAt) {
        notes[id] = {
          ...data,
          content: data.content || existing?.content,
          labels: [
            ...new Set([...(existing?.labels || []), ...(data.labels || [])]),
          ],
          isBookmarked: existing?.isBookmarked || data.isBookmarked,
          isLocked: existing?.isLocked || data.isLocked,
        };
      }
    }
    await storage.set('notes', notes);
  } else if (type === 'folders') {
    const folders = await storage.get('folders', {});
    if (!data) delete folders[id];
    else if (!folders[id] || data.updatedAt > folders[id].updatedAt)
      folders[id] = data;
    await storage.set('folders', folders);
  } else if (type === 'labels') {
    await storage.set('labels', data);
  } else if (type === 'deletedIds' || type === 'deletedFolderIds') {
    const current = await storage.get(type, {});
    await storage.set(type, { ...current, ...data });
  }
}

async function syncAssets(localDir, syncDir) {
  const localAssets = path.join(localDir, 'assets');
  const remoteAssets = path.join(syncDir, 'assets');

  await ipcRenderer.callMain('fs:ensureDir', localAssets);
  await ipcRenderer.callMain('fs:ensureDir', remoteAssets);

  const [local, remote] = await Promise.all([
    ipcRenderer.callMain('fs:readdir', localAssets),
    ipcRenderer.callMain('fs:readdir', remoteAssets),
  ]);

  // Copy missing files
  for (const file of remote.filter((f) => !local.includes(f))) {
    await ipcRenderer
      .callMain('fs:copy', {
        path: path.join(remoteAssets, file),
        dest: path.join(localAssets, file),
      })
      .catch(() => {});
  }
  for (const file of local.filter((f) => !remote.includes(f))) {
    await ipcRenderer
      .callMain('fs:copy', {
        path: path.join(localAssets, file),
        dest: path.join(remoteAssets, file),
      })
      .catch(() => {});
  }
}

async function compact(syncDir, commitsDir) {
  // Create snapshot
  const snapshot = {
    notes: await storage.get('notes', {}),
    folders: await storage.get('folders', {}),
    labels: await storage.get('labels', []),
    deletedIds: await storage.get('deletedIds', {}),
    deletedFolderIds: await storage.get('deletedFolderIds', {}),
  };

  await ipcRenderer.callMain('fs:output-json', {
    path: path.join(syncDir, 'snapshot.json'),
    data: { ts: Date.now(), data: snapshot },
  });

  // Remove old commits
  const files = await ipcRenderer.callMain('fs:readdir', commitsDir);
  for (const file of files)
    await ipcRenderer.callMain('fs:remove', path.join(commitsDir, file));

  await storage.set('lastCommitId', '', 'settings');
  console.log('Compacted');
}
