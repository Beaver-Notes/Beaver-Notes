import { toRaw } from 'vue';
import { useStorage } from '@/composable/storage';
import { path } from '@/lib/tauri-bridge';
import {
  ensureSyncDir,
  readSyncDir,
  readSyncFile,
  removeSyncPath,
  syncPathExists,
  writeSyncFile,
} from '@/lib/native/sync';

const storage = useStorage();

let deviceId =
  localStorage.getItem('deviceId') ||
  (() => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem('deviceId', id);
    return id;
  })();

let localClock = null;
let localClockInitPromise = null;

export function getSyncDeviceId() {
  return deviceId;
}

export function cloneCommitData(data) {
  return data !== undefined && data !== null
    ? structuredClone(toRaw(data))
    : null;
}

export async function ensureCommitsDir(syncPath) {
  const commitsDir = path.join(syncPath, 'BeaverNotesSync', 'commits');
  await ensureSyncDir(commitsDir);
  return commitsDir;
}

export async function listRemoteCommits(commitsDir, cursors, decryptJSON) {
  let files;
  try {
    files = await readSyncDir(commitsDir);
  } catch {
    return [];
  }

  const commits = [];

  for (const file of files.filter((entry) => entry.endsWith('.json'))) {
    let commit;
    try {
      const raw = await readSyncFile(path.join(commitsDir, file));
      commit = await decryptJSON(raw);
    } catch {
      continue;
    }

    if (!commit?.device || !commit?.clock) continue;
    if (commit.device === deviceId) continue;

    const seenUpTo = cursors[commit.device] ?? 0;
    if (commit.clock <= seenUpTo) continue;

    commits.push(commit);
  }

  return commits.sort((a, b) => a.ts - b.ts || a.clock - b.clock);
}

async function initLocalClockIfNeeded(loadCursors) {
  if (localClock !== null) return;
  if (!localClockInitPromise) {
    localClockInitPromise = (async () => {
      const [savedClock, cursors] = await Promise.all([
        storage.get('syncLocalClock', 0, 'settings'),
        loadCursors(),
      ]);
      const fromSettings = Number.isFinite(Number(savedClock))
        ? Number(savedClock)
        : 0;
      const fromCursor = Number.isFinite(Number(cursors?.[deviceId]))
        ? Number(cursors[deviceId])
        : 0;
      localClock = Math.max(0, fromSettings, fromCursor);
    })();
  }
  await localClockInitPromise;
}

async function nextLocalClock(loadCursors) {
  await initLocalClockIfNeeded(loadCursors);
  localClock += 1;
  await storage.set('syncLocalClock', localClock, 'settings');
  return localClock;
}

export async function writeCommit({
  key,
  data,
  commitsDir,
  encryptJSON,
  loadCursors,
  saveCursors,
}) {
  const [type, id] = key.split('.');
  const clock = await nextLocalClock(loadCursors);
  const cursors = await loadCursors();

  const commit = {
    id: `${Date.now()}-${deviceId}-${clock}`,
    device: deviceId,
    ts: Date.now(),
    clock,
    vector: { ...cursors, [deviceId]: clock },
    ops: [
      {
        type,
        id: id || type,
        data: cloneCommitData(data),
      },
    ],
  };

  const commitStr = await encryptJSON(commit);
  await writeSyncFile(path.join(commitsDir, `${commit.id}.json`), commitStr);

  cursors[deviceId] = clock;
  await saveCursors(cursors);

  return commit.id;
}

export async function queuePendingChange(key, data) {
  const pending = await storage.get('syncPendingChanges', {}, 'settings');
  pending[key] = {
    ts: Date.now(),
    data: cloneCommitData(data),
  };
  await storage.set('syncPendingChanges', pending, 'settings');
}

export async function flushPendingChanges(writePendingCommit) {
  const pending = await storage.get('syncPendingChanges', {}, 'settings');
  const entries = Object.entries(pending).sort(
    (a, b) => (a[1]?.ts ?? 0) - (b[1]?.ts ?? 0)
  );
  if (!entries.length) return 0;

  for (const [key, payload] of entries) {
    await writePendingCommit(key, payload?.data ?? null);
  }

  await storage.delete('syncPendingChanges', 'settings');
  return entries.length;
}

export async function flushPendingChangesIfReady(
  ensureSyncKeyReadyForWrite,
  writePendingCommit
) {
  const pending = await storage.get('syncPendingChanges', {}, 'settings');
  if (Object.keys(pending).length === 0) return false;

  try {
    await ensureSyncKeyReadyForWrite();
    await flushPendingChanges(writePendingCommit);
    return true;
  } catch {
    return false;
  }
}

export async function applySnapshotIfNeeded({
  syncDir,
  commitsDir,
  decryptJSON,
  saveCursors,
}) {
  const snapshotPath = path.join(syncDir, 'snapshot.json');
  const exists = await syncPathExists(snapshotPath).catch(() => false);
  if (!exists) return false;

  const [pending, files, lastApplied] = await Promise.all([
    storage.get('syncPendingChanges', {}, 'settings'),
    readSyncDir(commitsDir).catch(() => []),
    storage.get('syncSnapshotTs', 0, 'settings'),
  ]);

  if (Object.keys(pending).length > 0) return false;

  const hasOwnCommits = files.some(
    (file) => file.endsWith('.json') && file.includes(`-${deviceId}-`)
  );
  if (hasOwnCommits) return false;

  const raw = await readSyncFile(snapshotPath).catch(() => null);
  if (!raw) return false;

  const snapshot = await decryptJSON(raw);
  if (!snapshot?.data || typeof snapshot.data !== 'object') return false;

  const snapshotTs = Number(snapshot.ts) || 0;
  if (snapshotTs && snapshotTs <= Number(lastApplied || 0)) return false;

  // Write collections surgically: each note/folder is a separate row so we
  // never load the full store just to rewrite it. Non-collection keys are
  // single-row writes and stay fast regardless.
  const writes = [];

  for (const [id, note] of Object.entries(snapshot.data.notes ?? {})) {
    writes.push(storage.set(`notes.${id}`, note));
  }
  for (const [id, folder] of Object.entries(snapshot.data.folders ?? {})) {
    writes.push(storage.set(`folders.${id}`, folder));
  }
  writes.push(storage.set('labels', snapshot.data.labels ?? []));
  writes.push(storage.set('deletedIds', snapshot.data.deletedIds ?? {}));
  writes.push(storage.set('deletedFolderIds', snapshot.data.deletedFolderIds ?? {}));
  writes.push(storage.set('deletedAssets', snapshot.data.deletedAssets ?? {}));

  await Promise.all(writes);

  await saveCursors(
    snapshot.cursors && typeof snapshot.cursors === 'object'
      ? snapshot.cursors
      : {}
  );
  await storage.set('syncSnapshotTs', snapshotTs || Date.now(), 'settings');
  return true;
}

export async function compactSync({
  syncDir,
  commitsDir,
  encryptJSON,
  loadCursors,
  saveCursors,
}) {
  const lockPath = path.join(syncDir, 'compact.lock');
  const snapshotPath = path.join(syncDir, 'snapshot.json');
  const lockExists = await syncPathExists(lockPath);
  if (lockExists) {
    return;
  }

  try {
    await writeSyncFile(
      lockPath,
      JSON.stringify({ device: deviceId, ts: Date.now() })
    );

    const cursors = await loadCursors();
    const snapshotTs = Date.now();
    const snapshot = {
      ts: snapshotTs,
      cursors,
      data: {
        notes: await storage.get('notes', {}),
        folders: await storage.get('folders', {}),
        labels: await storage.get('labels', {}),
        deletedIds: await storage.get('deletedIds', {}),
        deletedFolderIds: await storage.get('deletedFolderIds', {}),
        deletedAssets: await storage.get('deletedAssets', {}),
      },
    };

    const snapshotStr = await encryptJSON(snapshot);
    await writeSyncFile(snapshotPath, snapshotStr);

    const files = await readSyncDir(commitsDir).catch(() => []);
    for (const file of files.filter((entry) => entry.endsWith('.json'))) {
      await removeSyncPath(path.join(commitsDir, file)).catch(() => {});
    }

    await saveCursors(cursors);
    await storage.set('syncSnapshotTs', snapshotTs, 'settings');
  } finally {
    await removeSyncPath(lockPath).catch(() => {});
  }
}
