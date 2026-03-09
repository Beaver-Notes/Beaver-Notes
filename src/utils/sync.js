import { toRaw } from 'vue';
import {
  encryptJSON,
  decryptJSON,
  syncAssetName,
  localAssetName,
  readAndEncryptAsset,
  decryptAndWriteAsset,
  ensureSyncKeyReadyForWrite,
  isSyncEncryptionEnabled,
  isSyncKeyLoaded,
} from './syncCrypto.js';
import { isAppEncryptionEnabled, isAppKeyLoaded } from './appCrypto.js';
import { getSyncPath } from './syncPath.js';
import { useStorage } from '@/composable/storage';
import { useNoteStore } from '@/store/note.js';
import { useFolderStore } from '@/store/folder.js';
import { backend, path } from '@/lib/tauri-bridge';
const storage = useStorage();

let deviceId =
  localStorage.getItem('deviceId') ||
  (() => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem('deviceId', id);
    return id;
  })();

const state = { syncing: false };
let syncQueue = Promise.resolve();
let localClock = null;
let localClockInitPromise = null;

export async function trackChange(key, data) {
  if (localStorage.getItem('autoSync') !== 'true') return;
  const syncPath = await getSyncPath();
  if (!syncPath) return;

  try {
    await ensureSyncKeyReadyForWrite();
    await _flushPendingChanges();
    await _writeCommit(key, data);
    enqueueSync();
  } catch (error) {
    try {
      await _queuePendingChange(key, data);
      console.warn(
        '[sync] Commit queued locally because sync encryption is locked or temporarily unavailable. It will be written after unlock.',
        error
      );
    } catch (queueError) {
      console.error('[sync] Failed to queue pending commit:', queueError);
    }
  }
}

export function forceSyncNow() {
  return enqueueSync(true);
}

export async function trackDeletedAssets(assetType, noteId, fileNames) {
  if (!fileNames?.length) return;

  const deletedAssets = await storage.get('deletedAssets', {});
  const ts = Date.now();

  for (const file of fileNames) {
    deletedAssets[`${assetType}/${noteId}/${file}`] = ts;
  }

  await storage.set('deletedAssets', deletedAssets);
  await trackChange('deletedAssets', deletedAssets);
}

function enqueueSync(force = false) {
  syncQueue = syncQueue.then(
    () => _sync(force),
    () => _sync(force)
  );
  return syncQueue;
}

async function _sync(force = false) {
  if (state.syncing && !force) return;

  const syncPath = await getSyncPath();
  if (!syncPath) return;

  state.syncing = true;

  try {
    const syncDir = path.join(syncPath, 'BeaverNotesSync');
    const commitsDir = path.join(syncDir, 'commits');
    await backend.invoke('fs:ensureDir', commitsDir);
    await _flushPendingChangesIfReady();

    const snapshotApplied = await _applySnapshotIfNeeded(syncDir, commitsDir);
    const cursors = await _loadCursors();
    const remoteCommits = await _getRemoteCommits(commitsDir, cursors);

    for (const commit of remoteCommits) {
      for (const op of commit.ops) {
        await _applyOp(op, commit.vector);
      }
      cursors[commit.device] = Math.max(
        cursors[commit.device] ?? 0,
        commit.clock
      );
    }

    if (remoteCommits.length > 0) {
      await _saveCursors(cursors);
    }
    const localDir = await storage.get('dataDir', '', 'settings');
    await _syncAssets(localDir, syncDir);
    const allFiles = await backend
      .invoke('fs:readdir', commitsDir)
      .catch(() => []);
    if (allFiles.filter((f) => f.endsWith('.json')).length > 200) {
      await _compact(syncDir, commitsDir);
    }
    if (remoteCommits.length > 0 || snapshotApplied) {
      await Promise.all([
        useNoteStore().retrieve(),
        useFolderStore().retrieve(),
      ]);
    }
  } catch (err) {
    console.error('[sync] Sync failed:', err);
  } finally {
    state.syncing = false;
  }
}

async function _getRemoteCommits(commitsDir, cursors) {
  let files;
  try {
    files = await backend.invoke('fs:readdir', commitsDir);
  } catch {
    return [];
  }

  const commits = [];

  for (const file of files.filter((f) => f.endsWith('.json'))) {
    let commit;
    try {
      const raw = await backend.invoke(
        'fs:readFile',
        path.join(commitsDir, file)
      );
      commit = await decryptJSON(raw);
    } catch {
      continue; // malformed or partially written — skip
    }
    if (!commit) continue; // decryption failed (wrong key or corrupt)

    if (!commit?.device || !commit?.clock) continue; // guard against legacy format
    if (commit.device === deviceId) continue;

    const seenUpTo = cursors[commit.device] ?? 0;
    if (commit.clock <= seenUpTo) continue; // already applied

    commits.push(commit);
  }
  return commits.sort((a, b) => a.ts - b.ts || a.clock - b.clock);
}

async function _applyOp(op, remoteVector) {
  const { type, id, data } = op;

  switch (type) {
    case 'notes':
      return _applyNote(id, data, remoteVector);
    case 'folders':
      return _applyFolder(id, data, remoteVector);
    case 'labels':
      return _applyLabels(data);
    case 'deletedIds':
      return _applyDeletedMap('deletedIds', data);
    case 'deletedFolderIds':
      return _applyDeletedMap('deletedFolderIds', data);
    case 'labelColors':
      return _applyLabelColors(data);
    case 'deletedAssets':
      return _applyDeletedAssets(data);
    default:
      console.warn('[sync] Unknown op type:', type);
  }
}

async function _applyNote(id, data, remoteVector) {
  const notes = await storage.get('notes', {});

  if (!data) {
    delete notes[id];
    await storage.set('notes', notes);
    return;
  }

  const existing = notes[id];

  if (!existing) {
    notes[id] = { ...data, _vector: remoteVector };
    await storage.set('notes', notes);
    return;
  }

  const localVector = existing._vector ?? {};
  const comparison = _compareVectors(remoteVector, localVector);

  if (comparison === 'local-wins') {
    return;
  }

  if (comparison === 'concurrent') {
    const conflictId = `${id}-conflict-${Date.now()}`;
    const conflictNote = {
      ...existing,
      id: conflictId,
      title: `${existing.title || 'Untitled'} (conflict copy)`,
      isConflict: true,
      conflictOf: id,
      _vector: localVector,
    };
    notes[conflictId] = conflictNote;
  }
  notes[id] = {
    ...data,
    isBookmarked: existing.isBookmarked || data.isBookmarked,
    isLocked: existing.isLocked || data.isLocked,
    labels: [...new Set([...(existing.labels ?? []), ...(data.labels ?? [])])],
    _vector: _mergeVectors(remoteVector, localVector),
  };

  await storage.set('notes', notes);
}

async function _applyFolder(id, data, remoteVector) {
  const folders = await storage.get('folders', {});

  if (!data) {
    delete folders[id];
    await storage.set('folders', folders);
    return;
  }

  const existing = folders[id];

  if (!existing) {
    folders[id] = { ...data, _vector: remoteVector };
    await storage.set('folders', folders);
    return;
  }

  const localVector = existing._vector ?? {};
  const comparison = _compareVectors(remoteVector, localVector);

  if (comparison === 'local-wins') return;

  folders[id] = {
    ...data,
    _vector: _mergeVectors(remoteVector, localVector),
  };

  await storage.set('folders', folders);
}

async function _applyLabels(data) {
  if (!data) return;
  const local = await storage.get('labels', []);
  const merged = [...new Set([...local, ...(Array.isArray(data) ? data : [])])];
  await storage.set('labels', merged);
}

async function _applyDeletedMap(key, data) {
  if (!data) return;
  const current = await storage.get(key, {});
  await storage.set(key, { ...current, ...data });
}

async function _applyDeletedAssets(data) {
  if (!data) return;
  const current = await storage.get('deletedAssets', {});
  await storage.set('deletedAssets', { ...current, ...data });
}

async function _applyLabelColors(data) {
  if (!data) return;
  const current = await storage.get('labelColors', {});
  await storage.set('labelColors', { ...current, ...data });
}

async function _copyRemoteToLocal(remotePath, localDest, mode) {
  const {
    appEncryptionEnabled,
    appKeyLoaded,
    syncEncryptionEnabled,
    syncKeyLoaded,
  } = mode;

  if (remotePath.endsWith('.enc')) {
    if (!syncEncryptionEnabled || !syncKeyLoaded) {
      return;
    }

    if (appEncryptionEnabled && !appKeyLoaded) {
      console.warn(
        `[sync] Skipping encrypted asset restore while app key is locked: ${localDest}`
      );
      return;
    }

    const cipher = await backend.invoke('fs:readFile', remotePath);
    await decryptAndWriteAsset(cipher, localDest, {
      skipAssetEncryption: !appEncryptionEnabled,
    });
  } else {
    await backend.invoke('fs:copy', {
      path: remotePath,
      dest: localDest,
    });
  }
}

async function _copyLocalToRemote(localPath, remoteDest, mode) {
  if (
    mode.syncEncryptionEnabled &&
    mode.syncKeyLoaded &&
    !mode.appEncryptionEnabled
  ) {
    const cipher = await readAndEncryptAsset(localPath);
    await backend.invoke('fs:writeFile', {
      path: remoteDest,
      data: cipher,
    });
  } else {
    await backend.invoke('fs:copy', {
      path: localPath,
      dest: remoteDest,
    });
  }
}

async function _syncAssets(localDir, syncDir) {
  const assetTypes = ['notes-assets', 'file-assets'];
  const deletedAssets = await storage.get('deletedAssets', {});
  let deletedAssetsDirty = false;
  const isIgnoredAssetEntry = (name) =>
    !name || name.startsWith('.') || name === 'Thumbs.db';
  const mode = {
    appEncryptionEnabled: isAppEncryptionEnabled(),
    appKeyLoaded: isAppKeyLoaded(),
    syncEncryptionEnabled: isSyncEncryptionEnabled(),
    syncKeyLoaded: isSyncKeyLoaded(),
  };

  for (const assetType of assetTypes) {
    const localBase = path.join(localDir, assetType);
    const remoteBase = path.join(syncDir, 'assets', assetType);

    await backend.invoke('fs:ensureDir', localBase);
    await backend.invoke('fs:ensureDir', remoteBase);
    const [localNoteIds, remoteNoteIds] = await Promise.all([
      backend
        .invoke('fs:readdir', localBase)
        .then((entries) =>
          entries.filter((entry) => !isIgnoredAssetEntry(entry))
        )
        .catch(() => []),
      backend
        .invoke('fs:readdir', remoteBase)
        .then((entries) =>
          entries.filter((entry) => !isIgnoredAssetEntry(entry))
        )
        .catch(() => []),
    ]);

    const allNoteIds = [...new Set([...localNoteIds, ...remoteNoteIds])];

    for (const noteId of allNoteIds) {
      if (isIgnoredAssetEntry(noteId)) continue;

      const localNoteDir = path.join(localBase, noteId);
      const remoteNoteDir = path.join(remoteBase, noteId);

      try {
        await backend.invoke('fs:ensureDir', localNoteDir);
        await backend.invoke('fs:ensureDir', remoteNoteDir);
      } catch (err) {
        console.warn(
          `[sync] Skipping invalid asset bucket "${assetType}/${noteId}":`,
          err
        );
        continue;
      }

      const [localFiles, remoteFiles] = await Promise.all([
        backend
          .invoke('fs:readdir', localNoteDir)
          .then((entries) =>
            entries.filter((entry) => !isIgnoredAssetEntry(entry))
          )
          .catch(() => []),
        backend
          .invoke('fs:readdir', remoteNoteDir)
          .then((entries) =>
            entries.filter((entry) => !isIgnoredAssetEntry(entry))
          )
          .catch(() => []),
      ]);
      const remoteFileMap = Object.fromEntries(
        remoteFiles.map((f) => [localAssetName(f), f])
      );
      const allLocalNames = [
        ...new Set([...localFiles, ...Object.keys(remoteFileMap)]),
      ];

      for (const file of allLocalNames) {
        const assetKey = `${assetType}/${noteId}/${file}`;
        const hasLocally = localFiles.includes(file);
        const remoteName = remoteFileMap[file];
        const hasRemotely = Boolean(remoteName);

        if (deletedAssets[assetKey] && hasLocally) {
          delete deletedAssets[assetKey];
          deletedAssetsDirty = true;
        }

        const isDeleted = Boolean(deletedAssets[assetKey]);

        if (isDeleted) {
          if (hasLocally) {
            await backend
              .invoke('fs:remove', path.join(localNoteDir, file))
              .catch(() => {});
          }
          if (hasRemotely && remoteName) {
            await backend
              .invoke('fs:remove', path.join(remoteNoteDir, remoteName))
              .catch(() => {});
          }
          continue;
        }

        if (hasRemotely && !hasLocally) {
          await _copyRemoteToLocal(
            path.join(remoteNoteDir, remoteName),
            path.join(localNoteDir, localAssetName(file)),
            mode
          ).catch(() => {});
        }

        if (hasLocally && !hasRemotely) {
          const remoteFileName = mode.appEncryptionEnabled
            ? file
            : syncAssetName(file);
          await _copyLocalToRemote(
            path.join(localNoteDir, file),
            path.join(remoteNoteDir, remoteFileName),
            mode
          ).catch(() => {});
        }
      }
    }
  }

  if (deletedAssetsDirty) {
    await storage.set('deletedAssets', deletedAssets);
    await trackChange('deletedAssets', deletedAssets);
  }
}

async function _compact(syncDir, commitsDir) {
  const lockPath = path.join(syncDir, 'compact.lock');
  const snapshotPath = path.join(syncDir, 'snapshot.json');
  const lockExists = await backend.invoke('fs:pathExists', lockPath);
  if (lockExists) {
    console.log('[sync] Compaction lock found — skipping compact this cycle');
    return;
  }

  try {
    await backend.invoke('fs:writeFile', {
      path: lockPath,
      data: JSON.stringify({ device: deviceId, ts: Date.now() }),
    });

    const cursors = await _loadCursors();
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
    await backend.invoke('fs:writeFile', {
      path: snapshotPath,
      data: snapshotStr,
    });
    const files = await backend
      .invoke('fs:readdir', commitsDir)
      .catch(() => []);
    for (const file of files.filter((f) => f.endsWith('.json'))) {
      await backend
        .invoke('fs:remove', path.join(commitsDir, file))
        .catch(() => {});
    }
    await _saveCursors(cursors);
    await storage.set('syncSnapshotTs', snapshotTs, 'settings');

    console.log('[sync] Compacted');
  } finally {
    await backend.invoke('fs:remove', lockPath).catch(() => {});
  }
}

function _compareVectors(remote, local) {
  const devices = [...new Set([...Object.keys(remote), ...Object.keys(local)])];
  let remoteAhead = false;
  let localAhead = false;

  for (const d of devices) {
    const r = remote[d] ?? 0;
    const l = local[d] ?? 0;
    if (r > l) remoteAhead = true;
    if (l > r) localAhead = true;
  }

  if (remoteAhead && !localAhead) return 'remote-wins';
  if (localAhead && !remoteAhead) return 'local-wins';
  if (!remoteAhead && !localAhead) return 'remote-wins'; // identical — idempotent
  return 'concurrent';
}

function _mergeVectors(a, b) {
  const result = { ...a };
  for (const [d, v] of Object.entries(b)) {
    result[d] = Math.max(result[d] ?? 0, v);
  }
  return result;
}

async function _loadCursors() {
  return storage.get('syncCursors', {}, 'settings');
}

async function _saveCursors(cursors) {
  return storage.set('syncCursors', cursors, 'settings');
}

async function _getCommitsDir() {
  const syncPath = await getSyncPath();
  if (!syncPath) return null;
  const commitsDir = path.join(syncPath, 'BeaverNotesSync', 'commits');
  await backend.invoke('fs:ensureDir', commitsDir);
  return commitsDir;
}

function _cloneCommitData(data) {
  return data !== undefined && data !== null
    ? JSON.parse(JSON.stringify(toRaw(data)))
    : null;
}

async function _initLocalClockIfNeeded() {
  if (localClock !== null) return;
  if (!localClockInitPromise) {
    localClockInitPromise = (async () => {
      const [savedClock, cursors] = await Promise.all([
        storage.get('syncLocalClock', 0, 'settings'),
        _loadCursors(),
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

async function _nextLocalClock() {
  await _initLocalClockIfNeeded();
  localClock += 1;
  await storage.set('syncLocalClock', localClock, 'settings');
  return localClock;
}

async function _writeCommit(key, data) {
  const commitsDir = await _getCommitsDir();
  if (!commitsDir) return null;

  const [type, id] = key.split('.');
  const clock = await _nextLocalClock();
  const cursors = await _loadCursors();

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
        data: _cloneCommitData(data),
      },
    ],
  };

  const commitStr = await encryptJSON(commit);
  await backend.invoke('fs:writeFile', {
    path: path.join(commitsDir, `${commit.id}.json`),
    data: commitStr,
  });

  cursors[deviceId] = clock;
  await _saveCursors(cursors);

  return commit.id;
}

async function _queuePendingChange(key, data) {
  const pending = await storage.get('syncPendingChanges', {}, 'settings');
  pending[key] = {
    ts: Date.now(),
    data: _cloneCommitData(data),
  };
  await storage.set('syncPendingChanges', pending, 'settings');
}

async function _flushPendingChanges() {
  const pending = await storage.get('syncPendingChanges', {}, 'settings');
  const entries = Object.entries(pending).sort(
    (a, b) => (a[1]?.ts ?? 0) - (b[1]?.ts ?? 0)
  );
  if (!entries.length) return 0;

  for (const [key, payload] of entries) {
    await _writeCommit(key, payload?.data ?? null);
  }

  await storage.delete('syncPendingChanges', 'settings');
  return entries.length;
}

async function _flushPendingChangesIfReady() {
  const pending = await storage.get('syncPendingChanges', {}, 'settings');
  if (Object.keys(pending).length === 0) return false;
  try {
    await ensureSyncKeyReadyForWrite();
    await _flushPendingChanges();
    return true;
  } catch {
    return false;
  }
}

async function _applySnapshotIfNeeded(syncDir, commitsDir) {
  const snapshotPath = path.join(syncDir, 'snapshot.json');
  const exists = await backend
    .invoke('fs:pathExists', snapshotPath)
    .catch(() => false);
  if (!exists) return false;

  const [pending, files, lastApplied] = await Promise.all([
    storage.get('syncPendingChanges', {}, 'settings'),
    backend.invoke('fs:readdir', commitsDir).catch(() => []),
    storage.get('syncSnapshotTs', 0, 'settings'),
  ]);

  if (Object.keys(pending).length > 0) return false;

  const hasOwnCommits = files.some(
    (file) => file.endsWith('.json') && file.includes(`-${deviceId}-`)
  );
  if (hasOwnCommits) return false;

  const raw = await backend
    .invoke('fs:readFile', snapshotPath)
    .catch(() => null);
  if (!raw) return false;

  const snapshot = await decryptJSON(raw);
  if (!snapshot?.data || typeof snapshot.data !== 'object') return false;

  const snapshotTs = Number(snapshot.ts) || 0;
  if (snapshotTs && snapshotTs <= Number(lastApplied || 0)) return false;

  await Promise.all([
    storage.set('notes', snapshot.data.notes ?? {}),
    storage.set('folders', snapshot.data.folders ?? {}),
    storage.set('labels', snapshot.data.labels ?? []),
    storage.set('deletedIds', snapshot.data.deletedIds ?? {}),
    storage.set('deletedFolderIds', snapshot.data.deletedFolderIds ?? {}),
    storage.set('deletedAssets', snapshot.data.deletedAssets ?? {}),
  ]);

  await _saveCursors(
    snapshot.cursors && typeof snapshot.cursors === 'object'
      ? snapshot.cursors
      : {}
  );
  await storage.set('syncSnapshotTs', snapshotTs || Date.now(), 'settings');
  return true;
}
