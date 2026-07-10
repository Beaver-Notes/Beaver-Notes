import { useStorage } from '@/composable/storage';
import { path } from '@/lib/tauri-bridge';
import {
  copyPath,
  ensureDir,
  readDir,
  readFile,
  removePath,
  pathExists,
  writeFile,
} from '@/lib/native/fs';
import { encryptJSON, decryptJSON } from './crypto.js';
import { localAssetName } from './crypto.js';
import {
  applySnapshotData,
  buildCommit,
  buildSnapshot,
  getSyncDeviceId,
  nextLocalClock,
} from './common.js';
import {
  ASSET_TYPES,
  ASSETS_DIR,
  COMMIT_FILE_EXT,
  COMMITS_DIR,
  COMPACT_LOCK_FILE,
  SNAPSHOT_FILE,
  STORAGE_KEY,
  SYNC_ROOT_DIR,
} from './constants.js';
import { getSyncPath } from './path.js';

const COMPACT_LOCK_TTL_MS = 10 * 60 * 1000;

const storage = useStorage();

function isIgnoredAssetEntry(name) {
  return !name || name.startsWith('.') || name === 'Thumbs.db';
}

function joinSyncRoot(syncPath) {
  return path.join(syncPath, SYNC_ROOT_DIR);
}

async function ensureCommitsDir(syncPath) {
  const commitsDir = path.join(syncPath, SYNC_ROOT_DIR, COMMITS_DIR);
  await ensureDir(commitsDir);
  return commitsDir;
}

async function loadCursors() {
  return storage.get(STORAGE_KEY.SYNC_CURSORS, {}, 'settings');
}

async function saveCursors(cursors) {
  return storage.set(STORAGE_KEY.SYNC_CURSORS, cursors, 'settings');
}

export async function folderReady() {
  const syncPath = await getSyncPath();
  return Boolean(syncPath && syncPath.trim());
}

export async function getCommitsDir() {
  const syncPath = await getSyncPath();
  if (!syncPath) return null;
  return ensureCommitsDir(syncPath);
}

export async function countCommits(commitsDir) {
  if (!commitsDir) return 0;
  try {
    const files = await readDir(commitsDir);
    return files.filter((entry) => entry.endsWith(COMMIT_FILE_EXT)).length;
  } catch {
    return 0;
  }
}

export async function listRemoteCommits(cursors) {
  const syncPath = await getSyncPath();
  if (!syncPath) return [];
  const commitsDir = await ensureCommitsDir(syncPath);

  let files;
  try {
    files = await readDir(commitsDir);
  } catch {
    return [];
  }

  const device = getSyncDeviceId();
  const commits = [];
  for (const file of files.filter((entry) => entry.endsWith(COMMIT_FILE_EXT))) {
    let commit;
    try {
      const raw = await readFile(path.join(commitsDir, file));
      commit = await decryptJSON(raw);
    } catch (err) {
      console.warn('[sync-folder] listRemoteCommits: decryptJSON failed:', err);
      continue;
    }

    if (!commit?.device || !commit?.clock) continue;
    if (commit.device === device) continue;

    const seenUpTo = cursors[commit.device] ?? 0;
    if (commit.clock <= seenUpTo) continue;
    commits.push(commit);
  }

  return commits.sort((a, b) => a.ts - b.ts || a.clock - b.clock);
}

export async function writeCommit({ key, data }) {
  const syncPath = await getSyncPath();
  if (!syncPath) return null;
  const commitsDir = await ensureCommitsDir(syncPath);

  const cursors = await loadCursors();
  const clock = await nextLocalClock(loadCursors);
  const commit = buildCommit({ key, data, cursors, clock, ts: Date.now() });

  const commitStr = await encryptJSON(commit);
  await writeFile(path.join(commitsDir, `${commit.id}.json`), commitStr);

  cursors[commit.device] = clock;
  await saveCursors(cursors);

  return commit.id;
}

export async function folderReadSnapshot() {
  const syncPath = await getSyncPath();
  if (!syncPath) return null;
  const syncDir = joinSyncRoot(syncPath);
  const snapshotPath = path.join(syncDir, SNAPSHOT_FILE);
  const exists = await pathExists(snapshotPath).catch(() => false);
  if (!exists) return null;
  const raw = await readFile(snapshotPath).catch(() => null);
  if (!raw) return null;
  try {
    return await decryptJSON(raw);
  } catch (err) {
    console.warn('[sync-folder] readSnapshot: decryptJSON failed:', err);
    return null;
  }
}

export async function applySnapshotIfNeeded() {
  const syncPath = await getSyncPath();
  if (!syncPath) return false;
  const syncDir = joinSyncRoot(syncPath);
  const snapshotPath = path.join(syncDir, SNAPSHOT_FILE);
  const exists = await pathExists(snapshotPath).catch(() => false);
  if (!exists) return false;

  const [pending, files, lastApplied] = await Promise.all([
    storage.get(STORAGE_KEY.SYNC_PENDING_CHANGES, {}, 'settings'),
    readDir(path.join(syncDir, COMMITS_DIR)).catch(() => []),
    storage.get(STORAGE_KEY.SYNC_SNAPSHOT_TS, 0, 'settings'),
  ]);
  if (Object.keys(pending).length > 0) return false;

  const device = getSyncDeviceId();
  const hasOwnCommits = files.some(
    (file) => file.endsWith(COMMIT_FILE_EXT) && file.includes(`-${device}-`)
  );
  if (hasOwnCommits) return false;

  const raw = await readFile(snapshotPath).catch(() => null);
  if (!raw) return false;

  let snapshot;
  try {
    snapshot = await decryptJSON(raw);
  } catch (err) {
    console.warn(
      '[sync-folder] applySnapshotIfNeeded: decryptJSON failed:',
      err
    );
    return false;
  }
  if (!snapshot?.data || typeof snapshot.data !== 'object') return false;
  const snapshotTs = Number(snapshot.ts) || 0;
  if (snapshotTs && snapshotTs <= Number(lastApplied || 0)) return false;

  return applySnapshotData(snapshot, saveCursors);
}

export async function compactSync() {
  const syncPath = await getSyncPath();
  if (!syncPath) return;
  const syncDir = joinSyncRoot(syncPath);
  const commitsDir = path.join(syncDir, COMMITS_DIR);
  const snapshotPath = path.join(syncDir, SNAPSHOT_FILE);
  const lockPath = path.join(syncDir, COMPACT_LOCK_FILE);

  const lockExists = await pathExists(lockPath).catch(() => false);
  if (lockExists) {
    try {
      const lockContent = await readFile(lockPath);
      const lockData = JSON.parse(lockContent);
      const lockAge = Date.now() - (lockData.ts || 0);
      if (lockAge < COMPACT_LOCK_TTL_MS) return;
      console.warn(
        `[sync-folder] Stale compact.lock detected (age: ${lockAge}ms) — removing`
      );
      await removePath(lockPath).catch(() => {});
    } catch {
      await removePath(lockPath).catch(() => {});
    }
  }

  try {
    const device = getSyncDeviceId();
    await writeFile(lockPath, JSON.stringify({ device, ts: Date.now() }));

    const cursors = await loadCursors();
    const snapshot = await buildSnapshot(cursors);
    const snapshotStr = await encryptJSON(snapshot);
    await writeFile(snapshotPath, snapshotStr);

    const files = await readDir(commitsDir).catch(() => []);
    for (const file of files.filter((entry) =>
      entry.endsWith(COMMIT_FILE_EXT)
    )) {
      await removePath(path.join(commitsDir, file)).catch(() => {});
    }

    await saveCursors(cursors);
    await storage.set(STORAGE_KEY.SYNC_SNAPSHOT_TS, snapshot.ts, 'settings');
  } finally {
    await removePath(lockPath).catch(() => {});
  }
}

function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function syncAssets(localDir, onDeletedAssetsChanged, onProgress) {
  const syncPath = await getSyncPath();
  if (!syncPath) return;
  const syncDir = joinSyncRoot(syncPath);

  const deletedAssets = await storage.get(STORAGE_KEY.DELETED_ASSETS, {});
  let deletedAssetsDirty = false;
  const ops = [];

  for (const assetType of ASSET_TYPES) {
    const localBase = path.join(localDir, assetType);
    const remoteBase = path.join(syncDir, ASSETS_DIR, assetType);

    await ensureDir(localBase);
    await ensureDir(remoteBase);

    const [localNoteIds, remoteNoteIds] = await Promise.all([
      readDir(localBase)
        .then((e) => e.filter((n) => !isIgnoredAssetEntry(n)))
        .catch(() => []),
      readDir(remoteBase)
        .then((e) => e.filter((n) => !isIgnoredAssetEntry(n)))
        .catch(() => []),
    ]);

    const allNoteIds = [...new Set([...localNoteIds, ...remoteNoteIds])];

    for (const noteId of allNoteIds) {
      if (isIgnoredAssetEntry(noteId)) continue;

      const localNoteDir = path.join(localBase, noteId);
      const remoteNoteDir = path.join(remoteBase, noteId);

      try {
        await ensureDir(localNoteDir);
        await ensureDir(remoteNoteDir);
      } catch (error) {
        console.warn(
          `[sync-folder] Skipping invalid asset bucket "${assetType}/${noteId}":`,
          error
        );
        continue;
      }

      const [localFiles, remoteFiles] = await Promise.all([
        readDir(localNoteDir)
          .then((e) => e.filter((f) => !isIgnoredAssetEntry(f)))
          .catch(() => []),
        readDir(remoteNoteDir)
          .then((e) => e.filter((f) => !isIgnoredAssetEntry(f)))
          .catch(() => []),
      ]);

      const remoteFileMap = Object.fromEntries(
        remoteFiles.map((f) => [localAssetName(f), f])
      );
      const allNames = [
        ...new Set([...localFiles, ...Object.keys(remoteFileMap)]),
      ];

      for (const file of allNames) {
        const assetKey = `${assetType}/${noteId}/${file}`;
        const hasLocally = localFiles.includes(file);
        const remoteName = remoteFileMap[file];
        const hasRemotely = Boolean(remoteName);

        if (deletedAssets[assetKey] && hasLocally) {
          delete deletedAssets[assetKey];
          deletedAssetsDirty = true;
        }

        if (deletedAssets[assetKey]) {
          if (hasLocally) {
            ops.push({
              type: 'remove-local',
              src: path.join(localNoteDir, file),
            });
          }
          if (hasRemotely && remoteName) {
            ops.push({
              type: 'remove-remote',
              src: path.join(remoteNoteDir, remoteName),
            });
          }
          continue;
        }

        if (hasRemotely && !hasLocally && remoteName) {
          ops.push({
            type: 'download',
            src: path.join(remoteNoteDir, remoteName),
            dest: path.join(localNoteDir, localAssetName(file)),
          });
        }

        if (hasLocally && !hasRemotely) {
          ops.push({
            type: 'upload',
            src: path.join(localNoteDir, file),
            dest: path.join(remoteNoteDir, file),
          });
        }
      }
    }
  }

  const total = ops.length;
  let processed = 0;

  onProgress?.({ phase: 'scan', processed: 0, total });

  for (let i = 0; i < total; i += 1) {
    const op = ops[i];
    try {
      switch (op.type) {
        case 'upload':
        case 'download':
          await copyPath(op.src, op.dest);
          break;
        case 'remove-local':
        case 'remove-remote':
          await removePath(op.src).catch(() => {});
          break;
      }
    } catch {
      // individual file failures are non-fatal
    }
    processed += 1;
    if (processed % 3 === 0) {
      await yieldToUi();
      onProgress?.({ phase: 'assets', processed, total });
    }
  }

  if (processed > 0) {
    onProgress?.({ phase: 'assets', processed, total });
  }

  if (deletedAssetsDirty) {
    await storage.set(STORAGE_KEY.DELETED_ASSETS, deletedAssets);
    await onDeletedAssetsChanged(deletedAssets);
  }
}
