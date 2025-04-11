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

  const autoSync = localStorage.getItem('autoSync');

  if (!state.syncInProgress && autoSync == 'true') {
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
      remoteMetadata = await ipcRenderer.callMain(
        'fs:read-json',
        path.join(syncFolderPath, 'metadata.json')
      );
      state.remoteVersion = remoteMetadata.version;
    } catch (error) {
      // Remote metadata doesn't exist yet, create it
      remoteMetadata = { version: 0 };
    }

    console.log(
      'Sync versions - Local:',
      localMetadata.version,
      'Remote:',
      remoteMetadata.version
    );

    // 4. Determine sync direction based on versions
    if (remoteMetadata.version > localMetadata.version) {
      // Remote is newer, pull changes
      console.log('Remote version is newer, pulling changes...');
      const pullSuccess = await pullChanges(
        syncFolderPath,
        remoteMetadata.version
      );

      if (pullSuccess) {
        console.log('Successfully pulled changes from remote');
        // Only sync assets if pull was successful
        await syncAssets(dataDir, syncFolderPath);
      } else {
        console.log('Pull operation failed or was canceled');
      }
    } else if (
      localMetadata.version > remoteMetadata.version ||
      pendingChanges.size > 0
    ) {
      // Local is newer or has pending changes, push changes
      console.log(
        'Local is newer or has pending changes, pushing to remote...'
      );
      const pushSuccess = await pushChanges(
        syncFolderPath,
        localMetadata.version
      );

      if (pushSuccess) {
        console.log('Successfully pushed changes to remote');
        // Only sync assets if push was successful
        await syncAssets(dataDir, syncFolderPath);
      } else {
        console.log('Push operation failed');
      }
    } else {
      // Versions are identical, just sync assets
      console.log('Versions are identical, syncing assets only');
      await syncAssets(dataDir, syncFolderPath);
    }

    // 5. Update sync status
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

// Pull changes from remote
async function pullChanges(syncFolderPath, remoteVersion) {
  const storage = useStorage();
  const translations = await useTranslation();

  try {
    console.log('Starting pull operation from remote...');

    // Read remote data file
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

    // Process data based on encryption status
    let dataToMerge;
    if (typeof remoteData === 'string') {
      // Data is encrypted
      console.log('Remote data is encrypted, requesting password...');
      const passwordResult = await promptForPassword(translations);
      if (!passwordResult.success) {
        console.log('Password prompt was canceled by user');
        return false;
      }

      try {
        console.log('Attempting to decrypt remote data...');
        const bytes = AES.decrypt(remoteData, passwordResult.password);
        const decryptedString = bytes.toString(Utf8);

        if (!decryptedString) {
          throw new Error('Decryption resulted in empty data');
        }

        dataToMerge = JSON.parse(decryptedString);

        // Store the password for future syncs if successful
        state.password = passwordResult.password;
        state.withPassword = true;
        console.log('Decryption successful');
      } catch (error) {
        console.error('Decryption error:', error);
        throw new Error(translations.settings.Invalidpassword);
      }
    } else {
      // Unencrypted data
      console.log('Remote data is not encrypted');
      dataToMerge = remoteData;
      state.withPassword = false;
    }

    // Verify data integrity
    if (!dataToMerge || typeof dataToMerge !== 'object') {
      console.error('Invalid data format after processing:', dataToMerge);
      throw new Error(translations.settings.invaliddata);
    }

    // Merge the pulled data with local data
    console.log('Merging remote data with local data...');
    await mergePulledData(dataToMerge);

    // Update local version to match remote version
    const updatedMetadata = {
      version: remoteVersion,
      lastSynced: Date.now(),
      lastPull: Date.now(),
    };

    await storage.set('syncMetadata', updatedMetadata, 'settings');
    state.localVersion = remoteVersion;
    state.remoteVersion = remoteVersion;

    console.log(
      'Pull completed successfully, local version updated to:',
      remoteVersion
    );
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
    console.log('Starting push operation to remote...');

    // Get all data to push
    const dataToSync = await prepareDataToSync();
    console.log('Prepared data for sync with keys:', Object.keys(dataToSync));

    // Encrypt if needed
    let finalData = dataToSync;
    if (state.withPassword && state.password) {
      console.log('Encrypting data before pushing...');
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
    console.log('Writing data to remote...');
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

    // Update remote version and clear pending changes
    state.remoteVersion = localVersion;
    pendingChanges.clear();
    console.log(
      'Push completed successfully, remote version updated to:',
      localVersion
    );

    return true;
  } catch (error) {
    console.error('Error pushing changes:', error);
    throw error;
  }
}

// Sync assets in both directions
async function syncAssets(dataDir, syncFolderPath) {
  console.log('Starting asset synchronization...');

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

  console.log(
    `Notes assets - Local: ${localNotesAssets.length}, Remote: ${remoteNotesAssets.length}`
  );
  console.log(
    `File assets - Local: ${localFileAssets.length}, Remote: ${remoteFileAssets.length}`
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

  console.log('Asset synchronization completed');
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

  console.log(`Files to download: ${filesToDownload.length}`);
  console.log(`Files to upload: ${filesToUpload.length}`);
  console.log(`Common files to compare: ${commonFiles.length}`);

  // Download new files from remote
  for (const file of filesToDownload) {
    console.log(`Downloading file: ${file}`);
    try {
      await ipcRenderer.callMain('fs:copy', {
        path: path.join(remoteDir, file),
        dest: path.join(localDir, file),
      });
    } catch (error) {
      console.error(`Error downloading file ${file}:`, error);
      // Continue with other files
    }
  }

  // Upload new files to remote
  for (const file of filesToUpload) {
    console.log(`Uploading file: ${file}`);
    try {
      await ipcRenderer.callMain('fs:copy', {
        path: path.join(localDir, file),
        dest: path.join(remoteDir, file),
      });
    } catch (error) {
      console.error(`Error uploading file ${file}:`, error);
      // Continue with other files
    }
  }

  // Handle conflict resolution for common files by comparing timestamps
  for (const file of commonFiles) {
    try {
      const localPath = path.join(localDir, file);
      const remotePath = path.join(remoteDir, file);

      const localStat = await ipcRenderer.callMain('fs:stat', localPath);
      const remoteStat = await ipcRenderer.callMain('fs:stat', remotePath);

      const localTime = new Date(localStat.mtime);
      const remoteTime = new Date(remoteStat.mtime);

      // If remote is newer, download it
      if (remoteTime > localTime) {
        console.log(`Remote file ${file} is newer, downloading`);
        await ipcRenderer.callMain('fs:copy', {
          path: remotePath,
          dest: localPath,
        });
      }
      // If local is newer, upload it
      else if (localTime > remoteTime) {
        console.log(`Local file ${file} is newer, uploading`);
        await ipcRenderer.callMain('fs:copy', {
          path: localPath,
          dest: remotePath,
        });
      }
      // If same timestamp, do nothing (already in sync)
      else {
        console.log(`File ${file} has same timestamp, skipping`);
      }
    } catch (error) {
      console.error(`Error processing common file ${file}:`, error);
      // Continue with other files
    }
  }
}

// Prepare all data for syncing
async function prepareDataToSync() {
  const storage = useStorage();
  const keysToSync = [
    'notes',
    'labels',
    'lockStatus',
    'isLocked',
    'settings',
    'deleteIds',
  ];
  const result = {};

  for (const key of keysToSync) {
    const defaultValue =
      key === 'notes' || key === 'lockStatus' || key === 'isLocked'
        ? {}
        : key === 'deleteIds'
        ? []
        : [];
    result[key] = await storage.get(key, defaultValue);
  }

  return result;
}

// Merge pulled data with local data
// Merge pulled data with local data
async function mergePulledData(importedData) {
  const storage = useStorage();
  const keys = [
    { key: 'notes', dfData: {} },
    { key: 'labels', dfData: [] },
    { key: 'lockStatus', dfData: {} },
    { key: 'isLocked', dfData: {} },
    { key: 'settings', dfData: {} },
    { key: 'deleteIds', dfData: [] }, // Add deleteIds to the list of keys to process
  ];

  console.log(
    'Beginning data merge process with keys:',
    keys.map((k) => k.key).join(', ')
  );

  // First, process deleteIds to ensure we have the complete list before modifying notes
  let combinedDeleteIds = [];
  if (importedData.deleteIds && Array.isArray(importedData.deleteIds)) {
    const currentDeleteIds = await storage.get('deleteIds', []);
    console.log(
      `Processing deleteIds - Current: ${currentDeleteIds.length}, Imported: ${importedData.deleteIds.length}`
    );

    // Combine local and remote deleteIds
    combinedDeleteIds = [
      ...new Set([...currentDeleteIds, ...importedData.deleteIds]),
    ];
    console.log(
      `Combined deleteIds - Total unique: ${combinedDeleteIds.length}`
    );

    // Save the combined deleteIds
    await storage.set('deleteIds', combinedDeleteIds);
    console.log('Successfully saved combined deleteIds');
  }

  // Then process all other data keys
  for (const { key, dfData } of keys) {
    // Skip deleteIds as we've already processed it
    if (key === 'deleteIds') continue;

    // Skip if the imported data doesn't contain this key
    if (!(key in importedData)) {
      console.log(`Key "${key}" not found in imported data, skipping`);
      continue;
    }

    try {
      const currentData = await storage.get(key, dfData);
      const importedDataForKey = importedData[key] ?? dfData;
      let mergedData;

      // Skip processing if imported data is invalid
      if (!importedDataForKey) {
        console.log(`Invalid imported data for key "${key}", skipping`);
        continue;
      }

      // Different merging strategies based on data type
      if (
        key === 'labels' &&
        Array.isArray(currentData) &&
        Array.isArray(importedDataForKey)
      ) {
        // For arrays like labels, merge and remove duplicates
        console.log(
          `Merging labels - Current: ${currentData.length}, Imported: ${importedDataForKey.length}`
        );
        const mergedArr = [...currentData, ...importedDataForKey];
        mergedData = [...new Set(mergedArr)];
        console.log(`Merged labels - Total unique: ${mergedData.length}`);
      } else if (key === 'notes') {
        // For notes, merge by ID, prefer the newer note, and respect deleteIds
        mergedData = { ...currentData };
        const currentNoteCount = Object.keys(currentData).length;
        const importedNoteCount = Object.keys(importedDataForKey).length;
        console.log(
          `Merging notes - Current: ${currentNoteCount}, Imported: ${importedNoteCount}`
        );

        // First, remove any notes that are in the combined deleteIds list
        let deletedCount = 0;
        for (const noteId of combinedDeleteIds) {
          if (noteId in mergedData) {
            delete mergedData[noteId];
            deletedCount++;
          }
        }
        console.log(`Deleted ${deletedCount} notes based on deleteIds`);

        // Then process the imported notes
        let updated = 0,
          added = 0,
          kept = 0,
          skipped = 0;

        for (const [noteId, importedNote] of Object.entries(
          importedDataForKey
        )) {
          // Skip notes that are in the deleteIds list
          if (combinedDeleteIds.includes(noteId)) {
            skipped++;
            continue;
          }

          const currentNote = mergedData[noteId];

          if (!currentNote) {
            // New note, add it
            mergedData[noteId] = importedNote;
            added++;
          } else if (
            importedNote.updatedAt &&
            currentNote.updatedAt &&
            new Date(importedNote.updatedAt) > new Date(currentNote.updatedAt)
          ) {
            // Remote note is newer, update local
            mergedData[noteId] = importedNote;
            updated++;
          } else {
            // Local note is newer or same age, keep it
            kept++;
          }
        }

        console.log(
          `Notes merge results - Added: ${added}, Updated: ${updated}, Kept: ${kept}, Skipped (deleted): ${skipped}`
        );
      } else if (
        typeof currentData === 'object' &&
        typeof importedDataForKey === 'object'
      ) {
        // For other objects like lockStatus and isLocked, deep merge
        mergedData = { ...currentData };

        // Default behavior: merge objects
        mergedData = { ...currentData, ...importedDataForKey };

        // For lockStatus, also respect deleteIds
        if (key === 'lockStatus') {
          for (const noteId of combinedDeleteIds) {
            if (noteId in mergedData) {
              delete mergedData[noteId];
            }
          }
        }

        console.log(`Merged object data for "${key}"`);
      } else {
        // For other data types, just use the imported data
        mergedData = importedDataForKey;
        console.log(`Replaced data for "${key}" with imported data`);
      }

      // Save the merged data
      await storage.set(key, mergedData);
      console.log(`Successfully saved merged data for "${key}"`);
    } catch (error) {
      console.error(`Error merging data for key "${key}":`, error);
      throw new Error(`Failed to merge data for ${key}: ${error.message}`);
    }
  }

  console.log('Data merge completed successfully');
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
