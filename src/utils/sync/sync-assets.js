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
import { mergeIntoMap } from '@/composable/useWorkspaceYjs';
import { getWorkspaceDoc } from '@/composable/meta-yjs-doc.js';
import { yMapToObj } from '@/utils/yjs-helpers.js';

function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ─── Remote listing cache ─────────────────────────────────────────────────────
//
// syncAssets previously re-listed every note's local + remote asset directory
// on every single sync call — O(notes × files) IO each cycle even when nothing
// changed. We cache the last listing per directory with a short TTL so that
// rapid successive syncs (e.g. the new periodic loop in #3, or multiple
// debounced note saves) reuse the previous result instead of re-reading disk.

const REMOTE_LISTING_TTL_MS = 30000;

const remoteListingCache = new Map();

async function cachedReadDir(dirPath, useCache) {
  if (useCache) {
    const cached = remoteListingCache.get(dirPath);
    if (cached && Date.now() - cached.t < REMOTE_LISTING_TTL_MS) {
      return cached.entries;
    }
  }
  const entries = await readSyncDir(dirPath)
    .then((e) => e.filter((n) => !isIgnoredAssetEntry(n)))
    .catch(() => []);
  remoteListingCache.set(dirPath, { t: Date.now(), entries });
  return entries;
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
            // The remote dir we just wrote to must be re-read next cycle.
            remoteListingCache.delete(path.dirname(op.dest));
            break;
          case 'download':
            await copyRemoteToLocal(op.src, op.dest);
            // Invalidate remote cache so the downloaded file is not
            // re-listed as absent on the next cycle.
            remoteListingCache.delete(path.dirname(op.src));
            break;
          case 'remove-local':
            await removeSyncPath(op.src).catch(() => {});
            break;
          case 'remove-remote':
            await removeSyncPath(op.src).catch(() => {});
            remoteListingCache.delete(path.dirname(op.src));
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

  // Use mergeIntoMap (not syncTombstoneMap / syncDeletedAssets) so that
  // deletion-tombstone entries added by a remote device between our
  // snapshot at the start of this cycle and now are preserved — the merge
  // only sets keys, it never deletes keys that aren't in the local snapshot.
  if (deletedAssetsDirty) {
    mergeIntoMap('deletedAssets', deletedAssets);
  }
}
