import { useStorage } from '@/composable/storage';
import { useTranslation } from '../composable/translations';
import { shallowReactive, ref } from 'vue';
import { Utf8 } from 'crypto-es/lib/core';
import { useDialog } from '@/composable/dialog';
import { AES } from 'crypto-es/lib/aes';

const { ipcRenderer, path, notification } = window.electron;
const dialog = useDialog();
const defaultPath = localStorage.getItem('default-path');
const syncStatus = ref('idle'); // 'idle', 'syncing', 'error', 'success'

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

// Cache for optimistic updates
const pendingChanges = new Map();

// Generate a unique change ID
function generateChangeId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Track changes locally with versions
export async function trackChange(key, data) {
  const storage = useStorage();
  const metadata = await storage.get(
    'syncMetadata',
    { version: 0 },
    'settings'
  );

  // Increment local version
  metadata.version += 1;
  metadata.lastModified = Date.now();

  // Store the change with version info
  const changeId = generateChangeId();
  pendingChanges.set(changeId, {
    key,
    data,
    version: metadata.version,
    timestamp: Date.now(),
  });

  // Update metadata
  await storage.set('syncMetadata', metadata, 'settings');
  state.localVersion = metadata.version;

  // Schedule sync if not already syncing
  if (!state.syncInProgress) {
    scheduleSyncWithDebounce();
  }

  return changeId;
}

// Debounce sync to avoid too many operations
let syncTimeout = null;
function scheduleSyncWithDebounce(immediate = false) {
  if (syncTimeout) {
    clearTimeout(syncTimeout);
  }

  if (immediate) {
    syncData();
  } else {
    syncTimeout = setTimeout(syncData, 5000); // 5 second debounce
  }
}

// Main sync function - handles both directions
export async function syncData() {
  if (state.syncInProgress) return;

  const translations = await useTranslation();
  const storage = useStorage();

  try {
    state.syncInProgress = true;
    syncStatus.value = 'syncing';
    state.syncError = null;

    // 1. Prepare paths
    const dataDir = await storage.get('dataDir', '', 'settings');
    if (!dataDir || !defaultPath) {
      throw new Error('Data directory or sync path not configured');
    }

    const syncFolderName = 'BeaverNotesSync';
    const syncFolderPath = path.join(defaultPath, syncFolderName);
    await ipcRenderer.callMain('fs:ensureDir', syncFolderPath);

    // 2. Get local metadata
    const localMetadata = await storage.get(
      'syncMetadata',
      { version: 0 },
      'settings'
    );

    // 3. Try to get remote metadata
    let remoteMetadata;
    try {
      const { data } = await ipcRenderer.callMain(
        'fs:read-json',
        path.join(syncFolderPath, 'metadata.json')
      );
      remoteMetadata = data || { version: 0 };
    } catch (error) {
      // Remote metadata doesn't exist yet, create it
      remoteMetadata = { version: 0 };
    }

    // 4. Compare versions to determine sync direction
    if (remoteMetadata.version > localMetadata.version) {
      // Remote is newer, pull changes
      await pullChanges(syncFolderPath, remoteMetadata.version);
    } else if (
      localMetadata.version > remoteMetadata.version ||
      pendingChanges.size > 0
    ) {
      // Local is newer or has pending changes, push changes
      await pushChanges(syncFolderPath, localMetadata.version);
    }

    // 5. Sync assets
    await syncAssets(dataDir, syncFolderPath);

    // 6. Update sync status
    state.lastSyncTime = Date.now();
    syncStatus.value = 'success';

    // Show notification
    notification({
      title: translations.sidebar.notification,
      body: translations.sidebar.syncSuccess,
    });
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

// Pull changes from remote
async function pullChanges(syncFolderPath, remoteVersion) {
  const storage = useStorage();
  const translations = await useTranslation();

  try {
    // Read remote data
    const { data: remoteData } = await ipcRenderer.callMain(
      'fs:read-json',
      path.join(syncFolderPath, 'data.json')
    );

    if (!remoteData) {
      throw new Error(translations.settings.invaliddata);
    }

    // Handle encrypted data
    if (typeof remoteData === 'string') {
      const passwordResult = await promptForPassword(translations);
      if (!passwordResult.success) {
        throw new Error(translations.settings.Invalidpassword);
      }

      try {
        const bytes = AES.decrypt(remoteData, passwordResult.password);
        const result = bytes.toString(Utf8);
        const decryptedData = JSON.parse(result);

        await mergePulledData(decryptedData);
      } catch (error) {
        throw new Error(translations.settings.Invalidpassword);
      }
    } else {
      // Unencrypted data
      await mergePulledData(remoteData);
    }

    // Update local version
    const metadata = {
      version: remoteVersion,
      lastSynced: Date.now(),
      lastPull: Date.now(),
    };
    await storage.set('syncMetadata', metadata, 'settings');
    state.localVersion = remoteVersion;
    state.remoteVersion = remoteVersion;

    return true;
  } catch (error) {
    console.error('Error pulling changes:', error);
    throw error;
  }
}

// Prompt for password dialog
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

// Push changes to remote
async function pushChanges(syncFolderPath, localVersion) {
  try {
    // Get all data to push
    const dataToSync = await prepareDataToSync();

    // Encrypt if needed
    let finalData = dataToSync;
    if (state.withPassword && state.password) {
      finalData = AES.encrypt(
        JSON.stringify(dataToSync),
        state.password
      ).toString();
    }

    // Create metadata
    const metadata = {
      version: localVersion,
      lastSynced: Date.now(),
      lastPush: Date.now(),
    };

    // Write data and metadata
    await ipcRenderer.callMain('fs:output-json', {
      path: path.join(syncFolderPath, 'data.json'),
      data: finalData,
    });

    await ipcRenderer.callMain('fs:output-json', {
      path: path.join(syncFolderPath, 'metadata.json'),
      data: metadata,
    });

    // Update remote version
    state.remoteVersion = localVersion;
    pendingChanges.clear();

    return true;
  } catch (error) {
    console.error('Error pushing changes:', error);
    throw error;
  }
}

// Sync assets in both directions
async function syncAssets(dataDir, syncFolderPath) {
  // Ensure asset directories exist
  const remoteNotesAssetsPath = path.join(syncFolderPath, 'notes-assets');
  const remoteFileAssetsPath = path.join(syncFolderPath, 'file-assets');
  const localNotesAssetsPath = path.join(dataDir, 'notes-assets');
  const localFileAssetsPath = path.join(dataDir, 'file-assets');

  await ipcRenderer.callMain('fs:ensureDir', remoteNotesAssetsPath);
  await ipcRenderer.callMain('fs:ensureDir', remoteFileAssetsPath);
  await ipcRenderer.callMain('fs:ensureDir', localNotesAssetsPath);
  await ipcRenderer.callMain('fs:ensureDir', localFileAssetsPath);

  // Get list of files in both locations
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

  // Sync notes assets
  await syncFileCollections(
    localNotesAssetsPath,
    remoteNotesAssetsPath,
    localNotesAssets,
    remoteNotesAssets
  );

  // Sync file assets
  await syncFileCollections(
    localFileAssetsPath,
    remoteFileAssetsPath,
    localFileAssets,
    remoteFileAssets
  );
}

// Sync two directories by comparing file lists and timestamps
async function syncFileCollections(
  localDir,
  remoteDir,
  localFiles,
  remoteFiles
) {
  // Find files that exist in remote but not local
  const filesToDownload = remoteFiles.filter(
    (file) => !localFiles.includes(file)
  );

  // Find files that exist in local but not remote
  const filesToUpload = localFiles.filter(
    (file) => !remoteFiles.includes(file)
  );

  // Find files that exist in both
  const commonFiles = localFiles.filter((file) => remoteFiles.includes(file));

  // Download new files from remote
  for (const file of filesToDownload) {
    await ipcRenderer.callMain('fs:copy', {
      path: path.join(remoteDir, file),
      dest: path.join(localDir, file),
    });
  }

  // Upload new files to remote
  for (const file of filesToUpload) {
    await ipcRenderer.callMain('fs:copy', {
      path: path.join(localDir, file),
      dest: path.join(remoteDir, file),
    });
  }

  // Handle conflict resolution for common files by comparing timestamps
  for (const file of commonFiles) {
    const localPath = path.join(localDir, file);
    const remotePath = path.join(remoteDir, file);

    const localStat = await ipcRenderer.callMain('fs:stat', localPath);
    const remoteStat = await ipcRenderer.callMain('fs:stat', remotePath);

    // If remote is newer, download it
    if (new Date(remoteStat.mtime) > new Date(localStat.mtime)) {
      await ipcRenderer.callMain('fs:copy', {
        path: remotePath,
        dest: localPath,
      });
    }
    // If local is newer, upload it
    else if (new Date(localStat.mtime) > new Date(remoteStat.mtime)) {
      await ipcRenderer.callMain('fs:copy', {
        path: localPath,
        dest: remotePath,
      });
    }
    // If same timestamp, do nothing (already in sync)
  }
}

// Prepare all data for syncing
async function prepareDataToSync() {
  const storage = useStorage();
  const keysToSync = ['notes', 'labels', 'lockStatus', 'isLocked', 'settings'];

  const result = {};

  for (const key of keysToSync) {
    const defaultValue =
      key === 'notes' || key === 'lockStatus' || key === 'isLocked' ? {} : [];
    result[key] = await storage.get(key, defaultValue);
  }

  return result;
}

// Merge pulled data with local data
async function mergePulledData(importedData) {
  const storage = useStorage();
  const keys = [
    { key: 'notes', dfData: {} },
    { key: 'labels', dfData: [] },
    { key: 'lockStatus', dfData: {} },
    { key: 'isLocked', dfData: {} },
    { key: 'settings', dfData: {} },
  ];

  for (const { key, dfData } of keys) {
    const currentData = await storage.get(key, dfData);
    const importedDataForKey = importedData[key] ?? dfData;
    let mergedData;

    if (key === 'labels') {
      // For arrays like labels, merge and remove duplicates
      const mergedArr = [...currentData, ...importedDataForKey];
      mergedData = [...new Set(mergedArr)];
    } else if (key === 'notes') {
      // For notes, merge by ID and prefer the newer note
      mergedData = { ...currentData };

      for (const [noteId, importedNote] of Object.entries(importedDataForKey)) {
        const currentNote = mergedData[noteId];

        if (
          !currentNote ||
          (importedNote.updatedAt &&
            currentNote.updatedAt &&
            new Date(importedNote.updatedAt) > new Date(currentNote.updatedAt))
        ) {
          mergedData[noteId] = importedNote;
        }
      }
    } else {
      // For other objects like lockStatus and isLocked, simple merge
      mergedData = { ...currentData, ...importedDataForKey };
    }

    await storage.set(key, mergedData);
  }
}

// Force immediate sync
export async function forceSyncNow() {
  return scheduleSyncWithDebounce(true);
}

// Get current sync status
export function getSyncStatus() {
  return {
    status: syncStatus.value,
    lastSynced: state.lastSyncTime ? new Date(state.lastSyncTime) : null,
    localVersion: state.localVersion,
    remoteVersion: state.remoteVersion,
    pendingChanges: pendingChanges.size,
  };
}

// Configure sync password
export function configureSyncPassword(usePassword, password) {
  state.withPassword = usePassword;
  state.password = password;
}
