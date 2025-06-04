import { useStorage } from '@/composable/storage';
import { useTranslation } from '../composable/translations';
import { shallowReactive, ref } from 'vue';
import { Utf8 } from 'crypto-es/lib/core';
import { AES } from 'crypto-es/lib/aes';
import { useDialog } from '@/composable/dialog';

const { ipcRenderer, path, notification } = window.electron;

// Preload composables
const storage = useStorage();
const dialog = useDialog();
const translationsPromise = useTranslation();

// App State
const syncStatus = ref('idle');
const defaultPath = localStorage.getItem('default-path');
const pendingChanges = new Map();
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

// Utilities
function generateChangeId() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// Debounce
let syncTimeout = null;
let lastScheduled = 0;
const SYNC_DEBOUNCE_MS = 60000; // 60 seconds

function scheduleSync(immediate = false) {
  const now = Date.now();

  if (immediate || now - lastScheduled > SYNC_DEBOUNCE_MS) {
    clearTimeout(syncTimeout);
    lastScheduled = now;
    return syncData();
  }

  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    lastScheduled = Date.now();
    syncData();
  }, SYNC_DEBOUNCE_MS);
}

// Change Tracking
export async function trackChange(key, data) {
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

  if (!state.syncInProgress && localStorage.getItem('autoSync') === 'true') {
    scheduleSync();
  }

  return changeId;
}

// Main Sync
export async function syncData() {
  if (state.syncInProgress || !defaultPath) return;

  const translations = await translationsPromise;
  try {
    state.syncInProgress = true;
    syncStatus.value = 'syncing';
    state.syncError = null;

    const dataDir = await storage.get('dataDir', '', 'settings');
    if (!dataDir) throw new Error('Data directory not set');

    const syncFolder = path.join(defaultPath, 'BeaverNotesSync');
    await ipcRenderer.callMain('fs:ensureDir', syncFolder);

    const localMetadata = await storage.get(
      'syncMetadata',
      { version: 0 },
      'settings'
    );
    let remoteMetadata = { version: 0 };
    try {
      remoteMetadata = await ipcRenderer.callMain(
        'fs:read-json',
        path.join(syncFolder, 'metadata.json')
      );
      state.remoteVersion = remoteMetadata.version;
    } catch {
      /* no remote metadata yet */
    }

    if (remoteMetadata.version > localMetadata.version) {
      await pullChanges(syncFolder, remoteMetadata.version);
    } else if (
      localMetadata.version > remoteMetadata.version ||
      pendingChanges.size > 0
    ) {
      await pushChanges(syncFolder, localMetadata.version);
    }

    await syncAssets(dataDir, syncFolder);

    state.lastSyncTime = Date.now();
    syncStatus.value = 'success';
  } catch (error) {
    console.error('Sync error:', error);
    syncStatus.value = 'error';
    state.syncError = error.message;

    notification({
      title: translations.sidebar.notification,
      body: translations.sidebar.syncFail,
    });
  } finally {
    state.syncInProgress = false;
  }
}

// Pull Changes
async function pullChanges(syncFolder, remoteVersion) {
  const translations = await translationsPromise;
  const remoteDataFile = path.join(syncFolder, 'data.json');

  let remoteData;
  try {
    remoteData = await ipcRenderer.callMain('fs:read-json', remoteDataFile);
  } catch (error) {
    throw new Error(`${translations.settings.invaliddata}: ${error.message}`);
  }

  let importedData = remoteData.data;
  if (typeof importedData === 'string') {
    const { success, password } = await promptForPassword(translations);
    if (!success) return;

    try {
      const bytes = AES.decrypt(importedData, password);
      const decrypted = bytes.toString(Utf8);
      importedData = JSON.parse(decrypted);

      state.password = password;
      state.withPassword = true;
    } catch {
      throw new Error(translations.settings.Invalidpassword);
    }
  } else {
    state.withPassword = false;
  }

  if (!importedData || typeof importedData !== 'object') {
    throw new Error(translations.settings.invaliddata);
  }

  await mergePulledData(importedData);

  await storage.set(
    'syncMetadata',
    {
      version: remoteVersion,
      lastSynced: Date.now(),
      lastPull: Date.now(),
    },
    'settings'
  );

  state.localVersion = remoteVersion;
  state.remoteVersion = remoteVersion;
}

// Push Changes
async function pushChanges(syncFolder, localVersion) {
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

  await ipcRenderer.callMain('fs:output-json', {
    path: path.join(syncFolder, 'data.json'),
    data: { data: finalData },
  });

  await ipcRenderer.callMain('fs:output-json', {
    path: path.join(syncFolder, 'metadata.json'),
    data: metadata,
  });

  state.remoteVersion = localVersion;
  pendingChanges.clear();
}

// Assets Sync
async function syncAssets(localDir, remoteDir) {
  const pairs = [
    {
      local: path.join(localDir, 'notes-assets'),
      remote: path.join(remoteDir, 'notes-assets'),
    },
    {
      local: path.join(localDir, 'file-assets'),
      remote: path.join(remoteDir, 'file-assets'),
    },
  ];

  for (const { local, remote } of pairs) {
    await ipcRenderer.callMain('fs:ensureDir', local);
    await ipcRenderer.callMain('fs:ensureDir', remote);

    const [localFiles, remoteFiles] = await Promise.all([
      ipcRenderer.callMain('fs:readdir', local),
      ipcRenderer.callMain('fs:readdir', remote),
    ]);

    await syncFileCollections(local, remote, localFiles, remoteFiles);
  }
}

async function syncFileCollections(
  localDir,
  remoteDir,
  localFiles,
  remoteFiles
) {
  const toDownload = remoteFiles.filter((f) => !localFiles.includes(f));
  const toUpload = localFiles.filter((f) => !remoteFiles.includes(f));

  for (const file of toDownload) {
    await safeCopy(path.join(remoteDir, file), path.join(localDir, file));
  }
  for (const file of toUpload) {
    await safeCopy(path.join(localDir, file), path.join(remoteDir, file));
  }
}

// Helpers
async function safeCopy(source, dest) {
  try {
    await ipcRenderer.callMain('fs:copy', { path: source, dest });
  } catch (error) {
    console.error(`Failed to copy ${source} → ${dest}:`, error);
  }
}

async function prepareDataToSync() {
  const keys = [
    'notes',
    'labels',
    'lockStatus',
    'isLocked',
    'settings',
    'deletedIds',
  ];
  const result = {};

  for (const key of keys) {
    const defaultValue = ['notes', 'lockStatus', 'isLocked'].includes(key)
      ? {}
      : [];
    result[key] = await storage.get(key, defaultValue);
  }
  return result;
}

async function mergePulledData(imported) {
  const keys = [
    'notes',
    'labels',
    'lockStatus',
    'isLocked',
    'settings',
    'deletedIds',
  ];
  const currentDeletedIds = await storage.get('deletedIds', []);

  const mergedDeletedIds = [
    ...new Set([...currentDeletedIds, ...(imported.deletedIds || [])]),
  ];
  await storage.set('deletedIds', mergedDeletedIds);

  for (const key of keys) {
    if (key === 'deletedIds') continue;
    const current = await storage.get(key, {});
    const incoming = imported[key];

    if (!incoming) continue;

    if (Array.isArray(current) && Array.isArray(incoming)) {
      await storage.set(key, [...new Set([...current, ...incoming])]);
    } else if (typeof current === 'object' && typeof incoming === 'object') {
      const merged = { ...current, ...incoming };
      if (key === 'notes' || key === 'lockStatus') {
        for (const id of mergedDeletedIds) delete merged[id];
      }
      await storage.set(key, merged);
    }
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
      onConfirm: (password) => resolve({ success: true, password }),
      onCancel: () => resolve({ success: false }),
    });
  });
}

// Public API
export function configureSyncPassword(usePassword, password) {
  state.withPassword = usePassword;
  state.password = password;
}

export function forceSyncNow() {
  return scheduleSync(true);
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
