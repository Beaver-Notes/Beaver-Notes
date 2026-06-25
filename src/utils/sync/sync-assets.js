import { useStorage } from '@/composable/storage';
import { path } from '@/lib/tauri-bridge';
import {
  copyPath as copySyncPath,
  ensureDir as ensureSyncDir,
  readDir as readSyncDir,
  readFile as readSyncFile,
  removePath as removeSyncPath,
  writeFile as writeSyncFile,
} from '@/lib/native/fs';
import { isEncryptionEnabled, isKeyLoaded } from '@/utils/crypto/encryption.js';
import { decryptAndWriteAsset, localAssetName } from './crypto.js';
import {
  ASSET_TYPES,
  ASSETS_DIR,
  ENCRYPTED_ASSET_EXT,
  STORAGE_KEY,
} from './constants.js';

function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const storage = useStorage();

function isIgnoredAssetEntry(name) {
  return !name || name.startsWith('.') || name === 'Thumbs.db';
}

async function copyRemoteToLocal(remotePath, localDest) {
  // Legacy: old sync repos used a sync-envelope format stored with .enc
  // extension. New files are raw bytes copied via fs:copy — the FS layer
  // transparently handles encryption on read/write via maybe_decrypt_asset
  // / maybe_encrypt_asset, so no explicit decryption is needed.
  if (remotePath.endsWith(ENCRYPTED_ASSET_EXT)) {
    if (!isKeyLoaded()) return;
    const cipher = await readSyncFile(remotePath);
    await decryptAndWriteAsset(cipher, localDest, {
      skipAssetEncryption: !isEncryptionEnabled(),
    });
    return;
  }
  // Fast path: single Rust-level file copy, no JS allocation or base64.
  await copySyncPath(remotePath, localDest);
}

async function copyLocalToRemote(localPath, remoteDest) {
  await copySyncPath(localPath, remoteDest);
}

export async function syncAssets(
  localDir,
  syncDir,
  onDeletedAssetsChanged,
  onProgress
) {
  const deletedAssets = await storage.get(STORAGE_KEY.DELETED_ASSETS, {});
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
    await storage.set(STORAGE_KEY.DELETED_ASSETS, deletedAssets);
    await onDeletedAssetsChanged(deletedAssets);
  }
}
