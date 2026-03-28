import { useStorage } from '@/composable/storage';
import { path } from '@/lib/tauri-bridge';
import {
  copySyncPath,
  ensureSyncDir,
  readSyncDir,
  readSyncFile,
  removeSyncPath,
  writeSyncFile,
} from '@/lib/native/sync';
import { isAppEncryptionEnabled, isAppKeyLoaded } from '@/utils/appCrypto.js';
import {
  decryptAndWriteAsset,
  isSyncEncryptionEnabled,
  isSyncKeyLoaded,
  localAssetName,
  readAndEncryptAsset,
  syncAssetName,
} from './crypto.js';

const storage = useStorage();

function isIgnoredAssetEntry(name) {
  return !name || name.startsWith('.') || name === 'Thumbs.db';
}

async function copyRemoteToLocal(remotePath, localDest, mode) {
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

    const cipher = await readSyncFile(remotePath);
    await decryptAndWriteAsset(cipher, localDest, {
      skipAssetEncryption: !appEncryptionEnabled,
    });
    return;
  }

  await copySyncPath(remotePath, localDest);
}

async function copyLocalToRemote(localPath, remoteDest, mode) {
  if (
    mode.syncEncryptionEnabled &&
    mode.syncKeyLoaded &&
    !mode.appEncryptionEnabled
  ) {
    const cipher = await readAndEncryptAsset(localPath);
    await writeSyncFile(remoteDest, cipher);
    return;
  }

  await copySyncPath(localPath, remoteDest);
}

export async function syncAssets(localDir, syncDir, onDeletedAssetsChanged) {
  const assetTypes = ['notes-assets', 'file-assets'];
  const deletedAssets = await storage.get('deletedAssets', {});
  let deletedAssetsDirty = false;
  const mode = {
    appEncryptionEnabled: isAppEncryptionEnabled(),
    appKeyLoaded: isAppKeyLoaded(),
    syncEncryptionEnabled: isSyncEncryptionEnabled(),
    syncKeyLoaded: isSyncKeyLoaded(),
  };

  for (const assetType of assetTypes) {
    const localBase = path.join(localDir, assetType);
    const remoteBase = path.join(syncDir, 'assets', assetType);

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
          const remoteFileName = mode.appEncryptionEnabled
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
    await storage.set('deletedAssets', deletedAssets);
    await onDeletedAssetsChanged(deletedAssets);
  }
}
