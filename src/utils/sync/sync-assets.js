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
  ASSETS_DIR,
} from './constants.js';
import { syncDeletedAssets } from '@/composable/useWorkspaceYjs';
import { getWorkspaceDoc } from '@/composable/meta-yjs-doc.js';
import { yMapToObj } from '@/utils/yjs-helpers.js';

function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function isIgnoredAssetEntry(name) {
  return !name || name.startsWith('.') || name === 'Thumbs.db';
}

async function copyRemoteToLocal(remotePath, localDest) {
  await copySyncPath(remotePath, localDest);
}

async function copyLocalToRemote(localPath, remoteDest) {
  await copySyncPath(localPath, remoteDest);
}

export async function syncAssets(
  localDir,
  syncDir,
  onProgress
) {
  const deletedAssets = yMapToObj(getWorkspaceDoc().getMap('deletedAssets'));
  let deletedAssetsDirty = false;

  const ops = [];

  for (const assetType of ASSET_TYPES) {
    const localBase = path.join(localDir, assetType);
    const remoteBase = path.join(syncDir, ASSETS_DIR, assetType);

    await ensureSyncDir(localBase);
    await ensureSyncDir(remoteBase);

    const [localNoteIds, remoteNoteIds] = await Promise.all([
      readSyncDir(localBase)
        .then((e) => e.filter((n) => !isIgnoredAssetEntry(n)))
        .catch(() => []),
      readSyncDir(remoteBase)
        .then((e) => e.filter((n) => !isIgnoredAssetEntry(n)))
        .catch(() => []),
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
        readSyncDir(remoteNoteDir)
          .then((e) => e.filter((f) => !isIgnoredAssetEntry(f)))
          .catch(() => []),
      ]);

      // map remote filenames (potentially .enc legacy) to local names
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
      switch (op.type) {
        case 'upload':
          await copyLocalToRemote(op.src, op.dest);
          break;
        case 'download':
          await copyRemoteToLocal(op.src, op.dest);
          break;
        case 'remove-local':
          await removeSyncPath(op.src).catch(() => {});
          break;
        case 'remove-remote':
          await removeSyncPath(op.src).catch(() => {});
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
    syncDeletedAssets(deletedAssets);
  }
}
