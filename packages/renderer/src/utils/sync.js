import { useStorage } from '@/composable/storage';
import { useTranslation } from '../composable/translations';
import { shallowReactive, ref } from 'vue';
import { Utf8 } from 'crypto-es/lib/core';
import { useDialog } from '@/composable/dialog';
import { AES } from 'crypto-es/lib/aes';

const { ipcRenderer, path, notification } = window.electron;
const dialog = useDialog();
const defaultPath = localStorage.getItem('default-path');
const syncStatus = ref('idle');

const state = shallowReactive({
  dataDir: '',
  password: '',
  fontSize: '16',
  withPassword: false,
  lastSyncTime: null,
  syncInProgress: false,
  syncError: null,
  remoteVersion: 0,
  localVersion: 0,
});

const pendingChanges = new Map();

function generateChangeId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export async function trackChange(key, data) {
  const storage = useStorage();
  const metadata = await storage.get(
    'syncMetadata',
    { version: 0 },
    'settings'
  );

  metadata.version += 1;
  metadata.lastModified = Date.now();

  const changeId = generateChangeId();
  pendingChanges.set(changeId, {
    key,
    data,
    version: metadata.version,
    timestamp: Date.now(),
  });

  await storage.set('syncMetadata', metadata, 'settings');
  state.localVersion = metadata.version;

  const autoSync = localStorage.getItem('autoSync');

  if (!state.syncInProgress && autoSync == 'true') {
    scheduleSyncWithDebounce();
  }

  return changeId;
}

let syncTimeout = null;
function scheduleSyncWithDebounce(immediate = false) {
  if (syncTimeout) {
    clearTimeout(syncTimeout);
  }

  if (immediate) {
    syncData();
  } else {
    syncTimeout = setTimeout(syncData, 5000);
  }
}

export async function syncData() {
  if (state.syncInProgress) return;

  const translations = await useTranslation();
  const storage = useStorage();

  try {
    state.syncInProgress = true;
    syncStatus.value = 'syncing';
    state.syncError = null;

    const dataDir = await storage.get('dataDir', '', 'settings');
    if (!dataDir || !defaultPath) {
      throw new Error('Data directory or sync path not configured');
    }

    const syncFolderName = 'BeaverNotesSync';
    const syncFolderPath = path.join(defaultPath, syncFolderName);
    await ipcRenderer.callMain('fs:ensureDir', syncFolderPath);

    const localMetadata = await storage.get(
      'syncMetadata',
      { version: 0 },
      'settings'
    );

    let remoteMetadata;
    try {
      remoteMetadata = await ipcRenderer.callMain(
        'fs:read-json',
        path.join(syncFolderPath, 'metadata.json')
      );
      state.remoteVersion = remoteMetadata.version;
    } catch (error) {
      remoteMetadata = { version: 0 };
    }

    if (remoteMetadata.version > localMetadata.version) {
      const pullSuccess = await pullChanges(
        syncFolderPath,
        remoteMetadata.version
      );

      if (pullSuccess) {
        await syncAssets(dataDir, syncFolderPath);
      } else {
        console.error('Pull operation failed or was canceled');
      }
    } else if (
      localMetadata.version > remoteMetadata.version ||
      pendingChanges.size > 0
    ) {
      const pushSuccess = await pushChanges(
        syncFolderPath,
        localMetadata.version
      );

      if (pushSuccess) {
        await syncAssets(dataDir, syncFolderPath);
      } else {
        console.error('Push operation failed or was canceled');
      }
    } else {
      await syncAssets(dataDir, syncFolderPath);
    }

    state.lastSyncTime = Date.now();
    syncStatus.value = 'success';
  } catch (error) {
    console.error('Sync error:', error);
    state.syncError = error.message;
    syncStatus.value = 'error';

    notification({
      title: translations.sidebar.notification,
      body: translations.sidebar.syncFail,
    });
  } finally {
    state.syncInProgress = false;
  }
}

async function pullChanges(syncFolderPath, remoteVersion) {
  const storage = useStorage();
  const translations = await useTranslation();

  try {
    let remoteDataResult;
    try {
      remoteDataResult = await ipcRenderer.callMain(
        'fs:read-json',
        path.join(syncFolderPath, 'data.json')
      );
    } catch (error) {
      console.error('Error reading remote data file:', error);
      throw new Error(`${translations.settings.invaliddata}: ${error.message}`);
    }

    const remoteData = remoteDataResult.data;
    if (!remoteData) {
      console.error('Remote data is empty or invalid');
      throw new Error(translations.settings.invaliddata);
    }

    let dataToMerge;
    if (typeof remoteData === 'string') {
      const passwordResult = await promptForPassword(translations);
      if (!passwordResult.success) {
        return false;
      }

      try {
        const bytes = AES.decrypt(remoteData, passwordResult.password);
        const decryptedString = bytes.toString(Utf8);

        if (!decryptedString) {
          throw new Error('Decryption resulted in empty data');
        }

        dataToMerge = JSON.parse(decryptedString);

        state.password = passwordResult.password;
        state.withPassword = true;
      } catch (error) {
        console.error('Decryption error:', error);
        throw new Error(translations.settings.Invalidpassword);
      }
    } else {
      dataToMerge = remoteData;
      state.withPassword = false;
    }

    if (!dataToMerge || typeof dataToMerge !== 'object') {
      console.error('Invalid data format after processing:', dataToMerge);
      throw new Error(translations.settings.invaliddata);
    }

    await mergePulledData(dataToMerge);

    const updatedMetadata = {
      version: remoteVersion,
      lastSynced: Date.now(),
      lastPull: Date.now(),
    };

    await storage.set('syncMetadata', updatedMetadata, 'settings');
    state.localVersion = remoteVersion;
    state.remoteVersion = remoteVersion;

    return true;
  } catch (error) {
    console.error('Error pulling changes:', error);
    throw error;
  }
}

function promptForPassword(translations) {
  return new Promise((resolve) => {
    dialog.prompt({
      title: translations.settings.Inputpassword,
      body: translations.settings.body,
      okText: translations.settings.Import,
      cancelText: translations.settings.Cancel,
      placeholder: translations.settings.Password,
      onConfirm: (password) => {
        resolve({ success: true, password });
      },
      onCancel: () => {
        resolve({ success: false });
      },
    });
  });
}

async function pushChanges(syncFolderPath, localVersion) {
  try {
    const dataToSync = await prepareDataToSync();

    let finalData = dataToSync;
    if (state.withPassword && state.password) {
      finalData = AES.encrypt(
        JSON.stringify(dataToSync),
        state.password
      ).toString();
    }

    const metadata = {
      version: localVersion,
      lastSynced: Date.now(),
      lastPush: Date.now(),
    };

    try {
      await ipcRenderer.callMain('fs:output-json', {
        path: path.join(syncFolderPath, 'data.json'),
        data: finalData,
      });

      await ipcRenderer.callMain('fs:output-json', {
        path: path.join(syncFolderPath, 'metadata.json'),
        data: metadata,
      });
    } catch (error) {
      console.error('Error writing files to remote:', error);
      throw error;
    }

    state.remoteVersion = localVersion;
    pendingChanges.clear();

    return true;
  } catch (error) {
    console.error('Error pushing changes:', error);
    throw error;
  }
}

async function syncAssets(dataDir, syncFolderPath) {
  const remoteNotesAssetsPath = path.join(syncFolderPath, 'notes-assets');
  const remoteFileAssetsPath = path.join(syncFolderPath, 'file-assets');
  const localNotesAssetsPath = path.join(dataDir, 'notes-assets');
  const localFileAssetsPath = path.join(dataDir, 'file-assets');

  await ipcRenderer.callMain('fs:ensureDir', remoteNotesAssetsPath);
  await ipcRenderer.callMain('fs:ensureDir', remoteFileAssetsPath);
  await ipcRenderer.callMain('fs:ensureDir', localNotesAssetsPath);
  await ipcRenderer.callMain('fs:ensureDir', localFileAssetsPath);

  const remoteNotesAssets = await ipcRenderer.callMain(
    'fs:readdir',
    remoteNotesAssetsPath
  );
  const remoteFileAssets = await ipcRenderer.callMain(
    'fs:readdir',
    remoteFileAssetsPath
  );
  const localNotesAssets = await ipcRenderer.callMain(
    'fs:readdir',
    localNotesAssetsPath
  );
  const localFileAssets = await ipcRenderer.callMain(
    'fs:readdir',
    localFileAssetsPath
  );

  await syncFileCollections(
    localNotesAssetsPath,
    remoteNotesAssetsPath,
    localNotesAssets,
    remoteNotesAssets
  );

  await syncFileCollections(
    localFileAssetsPath,
    remoteFileAssetsPath,
    localFileAssets,
    remoteFileAssets
  );
}

async function syncFileCollections(
  localDir,
  remoteDir,
  localFiles,
  remoteFiles
) {
  const filesToDownload = remoteFiles.filter(
    (file) => !localFiles.includes(file)
  );

  const filesToUpload = localFiles.filter(
    (file) => !remoteFiles.includes(file)
  );

  const commonFiles = localFiles.filter((file) => remoteFiles.includes(file));

  for (const file of filesToDownload) {
    try {
      await ipcRenderer.callMain('fs:copy', {
        path: path.join(remoteDir, file),
        dest: path.join(localDir, file),
      });
    } catch (error) {
      console.error(`Error downloading file ${file}:`, error);
    }
  }

  for (const file of filesToUpload) {
    try {
      await ipcRenderer.callMain('fs:copy', {
        path: path.join(localDir, file),
        dest: path.join(remoteDir, file),
      });
    } catch (error) {
      console.error(`Error uploading file ${file}:`, error);
    }
  }

  for (const file of commonFiles) {
    try {
      const localPath = path.join(localDir, file);
      const remotePath = path.join(remoteDir, file);

      const localStat = await ipcRenderer.callMain('fs:stat', localPath);
      const remoteStat = await ipcRenderer.callMain('fs:stat', remotePath);

      const localTime = new Date(localStat.mtime);
      const remoteTime = new Date(remoteStat.mtime);

      if (remoteTime > localTime) {
        await ipcRenderer.callMain('fs:copy', {
          path: remotePath,
          dest: localPath,
        });
      } else if (localTime > remoteTime) {
        await ipcRenderer.callMain('fs:copy', {
          path: localPath,
          dest: remotePath,
        });
      } else {
        // No action needed, files are identical
      }
    } catch (error) {
      console.error(`Error syncing file ${file}:`, error);
    }
  }
}

async function prepareDataToSync() {
  const storage = useStorage();
  const keysToSync = [
    'notes',
    'labels',
    'lockStatus',
    'isLocked',
    'settings',
    'deletedIds',
  ];
  const result = {};

  for (const key of keysToSync) {
    const defaultValue =
      key === 'notes' || key === 'lockStatus' || key === 'isLocked'
        ? {}
        : key === 'deletedIds'
        ? []
        : [];
    result[key] = await storage.get(key, defaultValue);
  }

  return result;
}

async function mergePulledData(importedData) {
  const storage = useStorage();
  const keys = [
    { key: 'notes', dfData: {} },
    { key: 'labels', dfData: [] },
    { key: 'lockStatus', dfData: {} },
    { key: 'isLocked', dfData: {} },
    { key: 'settings', dfData: {} },
    { key: 'deletedIds', dfData: [] },
  ];

  let combineddeletedIds = [];
  if (importedData.deletedIds && Array.isArray(importedData.deletedIds)) {
    const currentdeletedIds = await storage.get('deletedIds', []);

    combineddeletedIds = [
      ...new Set([...currentdeletedIds, ...importedData.deletedIds]),
    ];

    await storage.set('deletedIds', combineddeletedIds);
  }

  for (const { key, dfData } of keys) {
    if (key === 'deletedIds') continue;

    if (!(key in importedData)) {
      continue;
    }

    try {
      const currentData = await storage.get(key, dfData);
      const importedDataForKey = importedData[key] ?? dfData;
      let mergedData;

      if (!importedDataForKey) {
        continue;
      }

      if (
        key === 'labels' &&
        Array.isArray(currentData) &&
        Array.isArray(importedDataForKey)
      ) {
        const mergedArr = [...currentData, ...importedDataForKey];
        mergedData = [...new Set(mergedArr)];
      } else if (key === 'notes') {
        mergedData = { ...currentData };

        for (const noteId of combineddeletedIds) {
          if (noteId in mergedData) {
            delete mergedData[noteId];
          }
        }

        for (const [noteId, importedNote] of Object.entries(
          importedDataForKey
        )) {
          if (combineddeletedIds.includes(noteId)) {
            continue;
          }

          const currentNote = mergedData[noteId];

          if (!currentNote) {
            mergedData[noteId] = importedNote;
          } else if (
            importedNote.updatedAt &&
            currentNote.updatedAt &&
            new Date(importedNote.updatedAt) > new Date(currentNote.updatedAt)
          ) {
            mergedData[noteId] = importedNote;
          }
        }
      } else if (
        typeof currentData === 'object' &&
        typeof importedDataForKey === 'object'
      ) {
        mergedData = { ...currentData };

        mergedData = { ...currentData, ...importedDataForKey };

        if (key === 'lockStatus') {
          for (const noteId of combineddeletedIds) {
            if (noteId in mergedData) {
              delete mergedData[noteId];
            }
          }
        }
      } else {
        mergedData = importedDataForKey;
      }

      await storage.set(key, mergedData);
    } catch (error) {
      console.error(`Error merging data for key "${key}":`, error);
      throw new Error(`Failed to merge data for ${key}: ${error.message}`);
    }
  }
}

export async function forceSyncNow() {
  return scheduleSyncWithDebounce(true);
}

export function getSyncStatus() {
  return {
    status: syncStatus.value,
    lastSynced: state.lastSyncTime ? new Date(state.lastSyncTime) : null,
    localVersion: state.localVersion,
    remoteVersion: state.remoteVersion,
    pendingChanges: pendingChanges.size,
  };
}

export function configureSyncPassword(usePassword, password) {
  state.withPassword = usePassword;
  state.password = password;
}
