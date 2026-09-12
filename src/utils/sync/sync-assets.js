import { path } from '@/lib/tauri-bridge';
import {
  copyPath as copySyncPath,
  ensureDir as ensureSyncDir,
  readDir as readSyncDir,
  removePath as removeSyncPath,
} from '@/lib/native/fs';
import { localAssetName } from './crypto.js';
import {
  ASSET_TYPES,
} from './constants.js';
import { mergeIntoMap } from '@/lib/yjs/workspace-doc';
import { kickSyncDir } from '@/lib/tauri/scoped-storage';
import { withTimeout } from './sync-yjs.js';
import { getWorkspaceDoc } from '@/lib/yjs/meta-doc.js';
import { yMapToObj } from '@/lib/yjs/helpers.js';

export function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const REMOTE_LISTING_TTL_MS = 30000;
const MAX_CACHE_ENTRIES = 500;

const ASSET_OP_TIMEOUT_MS = 20000;

const remoteListingCache = new Map();

async function cachedReadDir(dirPath, useCache) {
  if (useCache) {
    const cached = remoteListingCache.get(dirPath);
    if (cached && Date.now() - cached.t < REMOTE_LISTING_TTL_MS) {
      remoteListingCache.delete(dirPath);
      remoteListingCache.set(dirPath, cached);
      return cached.entries;
    }
  }
  const entries = await readSyncDir(dirPath)
    .then((e) => e.filter((n) => !isIgnoredAssetEntry(n)))
    .catch(() => []);
  if (remoteListingCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = remoteListingCache.keys().next().value;
    remoteListingCache.delete(oldest);
  }
  remoteListingCache.set(dirPath, { t: Date.now(), entries });
  return entries;
}

function isIgnoredAssetEntry(name) {
  return !name || name.startsWith('.') || name === 'Thumbs.db';
}

export async function syncAssets(
  localDir,
  syncDir,
  onProgress
) {
  const deletedAssets = yMapToObj(getWorkspaceDoc().getMap('deletedAssets'));
  let deletedAssetsDirty = false;

  kickSyncDir(syncDir);

  const ops = [];

  for (const assetType of ASSET_TYPES) {
    const localBase = path.join(localDir, assetType);
    const remoteBase = path.join(syncDir, assetType);

    await ensureSyncDir(localBase);
    await ensureSyncDir(remoteBase);

    const [localNoteIds, remoteNoteIds] = await Promise.all([
      readSyncDir(localBase)
        .then((e) => e.filter((n) => !isIgnoredAssetEntry(n)))
        .catch(() => []),
      cachedReadDir(remoteBase, true),
    ]);

    const allNoteIds = [...new Set([...localNoteIds, ...remoteNoteIds])];

    for (const noteId of allNoteIds) {
      if (isIgnoredAssetEntry(noteId)) continue;

      const localNoteDir = path.join(localBase, noteId);
      const remoteNoteDir = path.join(remoteBase, noteId);

      try {
        await ensureSyncDir(localNoteDir);
        await ensureSyncDir(remoteNoteDir);
      } catch (error) {
        console.warn(
          `[sync] Skipping invalid asset bucket "${assetType}/${noteId}":`,
          error
        );
        continue;
      }

      const [localFiles, remoteFiles] = await Promise.all([
        readSyncDir(localNoteDir)
          .then((e) => e.filter((f) => !isIgnoredAssetEntry(f)))
          .catch(() => []),
        cachedReadDir(remoteNoteDir, true),
      ]);

      const localFileSet = new Set(localFiles);

      const remoteFileMap = Object.fromEntries(
        remoteFiles.map((f) => [localAssetName(f), f])
      );
      const allNames = [
        ...new Set([...localFiles, ...Object.keys(remoteFileMap)]),
      ];

      for (const file of allNames) {
        const assetKey = `${assetType}/${noteId}/${file}`;
        const hasLocally = localFileSet.has(file);
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

        if (hasRemotely && !hasLocally) {
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

  for (let i = 0; i < total; i++) {
    const op = ops[i];

    try {

      const copy = (() => {
        switch (op.type) {
          case 'upload':
            return copySyncPath(op.src, op.dest).then(() =>
              remoteListingCache.delete(path.dirname(op.dest)));
          case 'download':
            return copySyncPath(op.src, op.dest).then(() =>
              remoteListingCache.delete(path.dirname(op.src)));
          case 'remove-local':
            return removeSyncPath(op.src).catch(() => {}).then(() =>
              remoteListingCache.delete(path.dirname(op.src)));
          case 'remove-remote':
            return removeSyncPath(op.src).catch(() => {}).then(() =>
              remoteListingCache.delete(path.dirname(op.src)));
        }
      })();
      if (copy) await withTimeout(copy, ASSET_OP_TIMEOUT_MS, `asset ${op.type} ${op.src}`);
    } catch (e) {
      console.warn('[sync] asset op failed', op, e?.message);
    }

    processed += 1;

    await yieldToUi();
    onProgress?.({ phase: 'assets', processed, total });
  }

  if (processed > 0) {
    onProgress?.({ phase: 'assets', processed, total });
  }

  if (deletedAssetsDirty) {
    mergeIntoMap('deletedAssets', deletedAssets);
  }
}
