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
import { isEncryptionEnabled, isKeyLoaded } from '@/utils/encryption.js';
import {
  decryptAndWriteAsset,
  localAssetName,
  readAndEncryptAsset,
  syncAssetName,
} from './crypto.js';
import {
  ASSET_TYPES,
  ASSETS_DIR,
  ENCRYPTED_ASSET_EXT,
  STORAGE_KEY,
} from './constants.js';

const storage = useStorage();

function isIgnoredAssetEntry(name) {
  return !name || name.startsWith('.') || name === 'Thumbs.db';
}

async function copyRemoteToLocal(remotePath, localDest, mode) {
  const { encryptionEnabled, keyLoaded } = mode;

  if (remotePath.endsWith(ENCRYPTED_ASSET_EXT)) {
    if (!encryptionEnabled || !keyLoaded) {
      return;
    }

    const cipher = await readSyncFile(remotePath);
    await decryptAndWriteAsset(cipher, localDest, {
      skipAssetEncryption: !encryptionEnabled,
    });
    return;
  }

  await copySyncPath(remotePath, localDest);
}

async function copyLocalToRemote(localPath, remoteDest, mode) {
  if (mode.encryptionEnabled && mode.keyLoaded) {
    const cipher = await readAndEncryptAsset(localPath);
    await writeSyncFile(remoteDest, cipher);
    return;
  }

  await copySyncPath(localPath, remoteDest);
}

export async function syncAssets(localDir, syncDir, onDeletedAssetsChanged) {
  const assetTypes = ASSET_TYPES;
  const deletedAssets = await storage.get(STORAGE_KEY.DELETED_ASSETS, {});
  let deletedAssetsDirty = false;
  const mode = {
    encryptionEnabled: isEncryptionEnabled(),
    keyLoaded: isKeyLoaded(),
  };

  for (const assetType of assetTypes) {
    const localBase = path.join(localDir, assetType);
    const remoteBase = path.join(syncDir, ASSETS_DIR, assetType);

    await ensureSyncDir(localBase);
    await ensureSyncDir(remoteBase);

    const [localNoteIds, remoteNoteIds] = await Promise.all([
      readSyncDir(localBase)
        .then((entries) =>
          entries.filter((entry) => !isIgnoredAssetEntry(entry))
        )
        .catch(() => []),
      readSyncDir(remoteBase)
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
          .then((entries) =>
            entries.filter((entry) => !isIgnoredAssetEntry(entry))
          )
          .catch(() => []),
        readSyncDir(remoteNoteDir)
          .then((entries) =>
            entries.filter((entry) => !isIgnoredAssetEntry(entry))
          )
          .catch(() => []),
      ]);

      const remoteFileMap = Object.fromEntries(
        remoteFiles.map((file) => [localAssetName(file), file])
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

        if (deletedAssets[assetKey]) {
          if (hasLocally) {
            await removeSyncPath(path.join(localNoteDir, file)).catch(() => {});
          }
          if (hasRemotely && remoteName) {
            await removeSyncPath(path.join(remoteNoteDir, remoteName)).catch(
              () => {}
            );
          }
          continue;
        }

        if (hasRemotely && !hasLocally) {
          await copyRemoteToLocal(
            path.join(remoteNoteDir, remoteName),
            path.join(localNoteDir, localAssetName(file)),
            mode
          ).catch(() => {});
        }

        if (hasLocally && !hasRemotely) {
          const remoteFileName = mode.encryptionEnabled
            ? file
            : syncAssetName(file);
          await copyLocalToRemote(
            path.join(localNoteDir, file),
            path.join(remoteNoteDir, remoteFileName),
            mode
          ).catch(() => {});
        }
      }
    }
  }

  if (deletedAssetsDirty) {
    await storage.set(STORAGE_KEY.DELETED_ASSETS, deletedAssets);
    await onDeletedAssetsChanged(deletedAssets);
  }
}
