import { toRaw } from 'vue';
import { useStorage } from '@/composable/storage';
import { path } from '@/lib/tauri-bridge';
import {
  ensureDir as ensureSyncDir,
  readDir as readSyncDir,
  readFile as readSyncFile,
  removePath as removeSyncPath,
  pathExists as syncPathExists,
  writeFile as writeSyncFile,
} from '@/lib/native/fs';
import {
  COMMIT_FILE_EXT,
  COMMITS_DIR,
  COMPACT_LOCK_FILE,
  GENESIS_FILE,
  OpType,
  SNAPSHOT_FILE,
  STORAGE_KEY,
  SYNC_ROOT_DIR,
} from './constants.js';

const storage = useStorage();

let deviceId =
  localStorage.getItem('deviceId') ||
  (() => {
    const id = crypto.randomUUID();
    localStorage.setItem('deviceId', id);
    return id;
  })();

let localClock = null;
let localClockInitPromise = null;

export function getSyncDeviceId() {
  return deviceId;
}

export function cloneCommitData(data) {
  if (data === undefined || data === null) return null;
  return JSON.parse(JSON.stringify(toRaw(data)));
}

export async function ensureCommitsDir(syncPath) {
  const commitsDir = path.join(syncPath, SYNC_ROOT_DIR, COMMITS_DIR);
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
    } catch (err) {
      console.warn(
        '[sync-repository] listRemoteCommits: decryptJSON failed:',
        err
      );
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
        storage.get(STORAGE_KEY.SYNC_LOCAL_CLOCK, 0, 'settings'),
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
  await storage.set(STORAGE_KEY.SYNC_LOCAL_CLOCK, localClock, 'settings');
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
  const pending = await storage.get(
    STORAGE_KEY.SYNC_PENDING_CHANGES,
    {},
    'settings'
  );
  pending[key] = {
    ts: Date.now(),
    data: cloneCommitData(data),
  };
  await storage.set(STORAGE_KEY.SYNC_PENDING_CHANGES, pending, 'settings');
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

  await storage.delete(STORAGE_KEY.SYNC_PENDING_CHANGES, 'settings');
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
  const snapshotPath = path.join(syncDir, SNAPSHOT_FILE);
  const exists = await syncPathExists(snapshotPath).catch(() => false);
  if (!exists) return false;

  const [pending, files, lastApplied] = await Promise.all([
    storage.get(STORAGE_KEY.SYNC_PENDING_CHANGES, {}, 'settings'),
    readSyncDir(commitsDir).catch(() => []),
    storage.get(STORAGE_KEY.SYNC_SNAPSHOT_TS, 0, 'settings'),
  ]);

  if (Object.keys(pending).length > 0) return false;

  const hasOwnCommits = files.some(
    (file) => file.endsWith(COMMIT_FILE_EXT) && file.includes(`-${deviceId}-`)
  );
  if (hasOwnCommits) return false;

  const raw = await readSyncFile(snapshotPath).catch(() => null);
  if (!raw) return false;

  let snapshot;
  try {
    snapshot = await decryptJSON(raw);
  } catch (err) {
    console.warn(
      '[sync-repository] applySnapshotIfNeeded: decryptJSON failed:',
      err
    );
    return false;
  }
  if (!snapshot?.data || typeof snapshot.data !== 'object') return false;

  const snapshotTs = Number(snapshot.ts) || 0;
  if (snapshotTs && snapshotTs <= Number(lastApplied || 0)) return false;

  // Write collections surgically: each note/folder is a separate row so we
  // never load the full store just to rewrite it. Non-collection keys are
  // single-row writes and stay fast regardless.
  const writes = [];

  for (const [id, note] of Object.entries(snapshot.data[OpType.NOTES] ?? {})) {
    writes.push(storage.set(`notes.${id}`, note));
  }
  for (const [id, folder] of Object.entries(
    snapshot.data[OpType.FOLDERS] ?? {}
  )) {
    writes.push(storage.set(`folders.${id}`, folder));
  }
  writes.push(storage.set(OpType.LABELS, snapshot.data[OpType.LABELS] ?? []));
  writes.push(
    storage.set(OpType.DELETED_IDS, snapshot.data[OpType.DELETED_IDS] ?? {})
  );
  writes.push(
    storage.set(
      OpType.DELETED_FOLDER_IDS,
      snapshot.data[OpType.DELETED_FOLDER_IDS] ?? {}
    )
  );
  writes.push(
    storage.set(
      OpType.DELETED_ASSETS,
      snapshot.data[OpType.DELETED_ASSETS] ?? {}
    )
  );

  await Promise.all(writes);

  await saveCursors(
    snapshot.cursors && typeof snapshot.cursors === 'object'
      ? snapshot.cursors
      : {}
  );
  await storage.set(
    STORAGE_KEY.SYNC_SNAPSHOT_TS,
    snapshotTs || Date.now(),
    'settings'
  );
  return true;
}

export async function genesisExists(syncDir) {
  const genesisPath = path.join(syncDir, GENESIS_FILE);
  return syncPathExists(genesisPath).catch(() => false);
}

export async function writeGenesisState({
  syncDir,
  encryptJSON,
}) {
  const genesisPath = path.join(syncDir, GENESIS_FILE);
  const exists = await syncPathExists(genesisPath).catch(() => false);
  if (exists) return false;

  const data = {
    notes: await storage.get('notes', {}),
    folders: await storage.get('folders', {}),
    labels: await storage.get('labels', []),
    deletedIds: await storage.get('deletedIds', {}),
    deletedFolderIds: await storage.get('deletedFolderIds', {}),
    deletedAssets: await storage.get('deletedAssets', {}),
    labelColors: await storage.get('labelColors', {}),
  };

  const genesis = {
    genesis: true,
    v: 1,
    ts: Date.now(),
    deviceId,
    data,
  };

  const encrypted = await encryptJSON(genesis);
  await writeSyncFile(genesisPath, encrypted);
  return true;
}

export async function applyGenesisIfNeeded({
  syncDir,
  decryptJSON,
  saveCursors,
}) {
  const cursors = await storage.get(STORAGE_KEY.SYNC_CURSORS, {}, 'settings');
  const hasSyncHistory = Object.keys(cursors).length > 0;
  if (hasSyncHistory) return false;

  const genesisPath = path.join(syncDir, GENESIS_FILE);
  const exists = await syncPathExists(genesisPath).catch(() => false);
  if (!exists) return false;

  let genesis;
  try {
    const raw = await readSyncFile(genesisPath);
    genesis = await decryptJSON(raw);
  } catch (err) {
    console.warn('[sync-repository] Failed to read genesis:', err);
    return false;
  }

  if (!genesis?.genesis || !genesis?.data) return false;

  const writes = [];

  for (const [id, note] of Object.entries(genesis.data.notes ?? {})) {
    writes.push(storage.set(`notes.${id}`, { ...note, _vector: {} }));
  }
  for (const [id, folder] of Object.entries(genesis.data.folders ?? {})) {
    writes.push(storage.set(`folders.${id}`, { ...folder, _vector: {} }));
  }
  writes.push(storage.set('labels', genesis.data.labels ?? []));
  writes.push(storage.set('deletedIds', genesis.data.deletedIds ?? {}));
  writes.push(storage.set('deletedFolderIds', genesis.data.deletedFolderIds ?? {}));
  writes.push(storage.set('deletedAssets', genesis.data.deletedAssets ?? {}));
  writes.push(storage.set('labelColors', genesis.data.labelColors ?? {}));

  await Promise.all(writes);

  const genesisCursors = {};
  genesisCursors[genesis.deviceId] = 0;
  await saveCursors(genesisCursors);

  console.log('[sync] Genesis applied — state initialised from genesis');
  return true;
}

export async function compactSync({
  syncDir,
  commitsDir,
  encryptJSON,
  loadCursors,
  saveCursors,
}) {
  const lockPath = path.join(syncDir, COMPACT_LOCK_FILE);
  const snapshotPath = path.join(syncDir, SNAPSHOT_FILE);
  const lockExists = await syncPathExists(lockPath);
  if (lockExists) {
    try {
      const lockContent = await readSyncFile(lockPath);
      const lockData = JSON.parse(lockContent);
      const lockAge = Date.now() - (lockData.ts || 0);
      if (lockAge < 10 * 60 * 1000) return;
      console.warn(
        `[sync] Stale compact.lock detected (age: ${lockAge}ms) — removing`
      );
      await removeSyncPath(lockPath).catch(() => {});
    } catch {
      await removeSyncPath(lockPath).catch(() => {});
    }
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
        [OpType.NOTES]: await storage.get('notes', {}),
        [OpType.FOLDERS]: await storage.get('folders', {}),
        [OpType.LABELS]: await storage.get('labels', {}),
        [OpType.DELETED_IDS]: await storage.get('deletedIds', {}),
        [OpType.DELETED_FOLDER_IDS]: await storage.get('deletedFolderIds', {}),
        [OpType.DELETED_ASSETS]: await storage.get('deletedAssets', {}),
      },
    };

    const snapshotStr = await encryptJSON(snapshot);
    await writeSyncFile(snapshotPath, snapshotStr);

    // Update genesis alongside the snapshot so newly joining devices
    // always start from the latest compacted state, not the very first one.
    const genesisPath = path.join(syncDir, GENESIS_FILE);
    const genesisPayload = {
      genesis: true,
      v: 1,
      ts: snapshotTs,
      deviceId,
      data: snapshot.data,
    };
    await writeSyncFile(genesisPath, await encryptJSON(genesisPayload));

    const files = await readSyncDir(commitsDir).catch(() => []);
    for (const file of files.filter((entry) =>
      entry.endsWith(COMMIT_FILE_EXT)
    )) {
      await removeSyncPath(path.join(commitsDir, file)).catch(() => {});
    }

    await saveCursors(cursors);
    await storage.set(STORAGE_KEY.SYNC_SNAPSHOT_TS, snapshotTs, 'settings');
  } finally {
    await removeSyncPath(lockPath).catch(() => {});
  }
}
