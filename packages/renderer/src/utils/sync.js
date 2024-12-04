import { useStorage } from '@/composable/storage';
import { useTranslation } from '../composable/translations';
import { shallowReactive } from 'vue';
import { Utf8 } from 'crypto-es/lib/core';
import { useDialog } from '@/composable/dialog';
import { AES } from 'crypto-es/lib/aes';
import dayjs from '@/lib/dayjs';

const { ipcRenderer, path, notification } = window.electron;
const dialog = useDialog();
const defaultPath = localStorage.getItem('default-path');
const state = shallowReactive({
  dataDir: '',
  password: '',
  fontSize: '16',
  withPassword: false,
  lastUpdated: null,
});

function showAlert(message, options = {}) {
  ipcRenderer.callMain('dialog:message', {
    type: 'error',
    title: 'Alert',
    message,
    ...options,
  });
}

export async function syncexportData() {
  const translations = await useTranslation();
  const storage = useStorage();

  try {
    const changelogPath = path.join(defaultPath, 'changelog.json');

    let data = await storage.store();

    if (state.withPassword) {
      data = AES.encrypt(JSON.stringify(data), state.password).toString();
    }

    const folderName = dayjs().format('[Beaver Notes] YYYY-MM-DD');
    const dataDir = await storage.get('dataDir', '', 'settings');
    const exportPath = defaultPath;
    const folderPath = path.join(exportPath, folderName);

    // Load or initialize the changelog
    let changelog = {};
    try {
      changelog = await ipcRenderer.callMain('fs:read-json', changelogPath);
    } catch {
      changelog = { changes: [] }; // Initialize with empty changes if not found
    }

    const lastExportDate = changelog.changes.length
      ? new Date(changelog.changes[changelog.changes.length - 1].date)
      : null;
    const newExportDate = new Date().toISOString();
    let exportedFiles = [];

    // Ensure the directory exists
    await ipcRenderer.callMain('fs:ensureDir', folderPath);

    // Save main data.json
    const dataPath = path.join(folderPath, 'data.json');
    await ipcRenderer.callMain('fs:output-json', {
      path: dataPath,
      data: { data },
    });
    exportedFiles.push('data.json');

    // Incremental export of notes-assets
    const notesAssetsSource = path.join(dataDir, 'notes-assets');
    const notesAssetsDest = path.join(folderPath, 'assets');
    const notesFiles = await ipcRenderer.callMain(
      'fs:readdir',
      notesAssetsSource
    );

    for (const file of notesFiles) {
      const sourceFilePath = path.join(notesAssetsSource, file);
      const destFilePath = path.join(notesAssetsDest, file);

      const stats = await ipcRenderer.callMain('fs:stat', sourceFilePath);
      if (!lastExportDate || new Date(stats.mtime) > lastExportDate) {
        await ipcRenderer.callMain('fs:copy', {
          path: sourceFilePath,
          dest: destFilePath,
        });
        exportedFiles.push(`notes-assets/${file}`);
      }
    }

    // Incremental export of file-assets
    const fileAssetsSource = path.join(dataDir, 'file-assets');
    const fileAssetsDest = path.join(folderPath, 'file-assets');
    const fileFiles = await ipcRenderer.callMain(
      'fs:readdir',
      fileAssetsSource
    );

    for (const file of fileFiles) {
      const sourceFilePath = path.join(fileAssetsSource, file);
      const destFilePath = path.join(fileAssetsDest, file);

      const stats = await ipcRenderer.callMain('fs:stat', sourceFilePath);
      if (!lastExportDate || new Date(stats.mtime) > lastExportDate) {
        await ipcRenderer.callMain('fs:copy', {
          path: sourceFilePath,
          dest: destFilePath,
        });
        exportedFiles.push(`file-assets/${file}`);
      }
    }

    // Add the new export entry to the changelog
    changelog.changes.push({ date: newExportDate, files: exportedFiles });

    // Trim changelog to retain only the past month
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    changelog.changes = changelog.changes.filter(
      (entry) => new Date(entry.date) >= oneMonthAgo
    );

    await ipcRenderer.callMain('fs:output-json', {
      path: changelogPath,
      data: changelog,
    });

    state.withPassword = false;
    state.password = '';
  } catch (error) {
    // Error notification
    notification({
      title: translations.sidebar.notification,
      body: translations.sidebar.exportFail,
    });
    console.error('Error during syncexportData:', error);
  }
}

export async function syncimportData() {
  const translations = await useTranslation();
  const storage = useStorage();

  try {
    const today = dayjs();
    const folderName = today.format('[Beaver Notes] YYYY-MM-DD');
    const dataDir = await storage.get('dataDir', '', 'settings');
    const dirPath = path.join(defaultPath, folderName);

    if (!defaultPath) return;

    const importData = async (data) => {
      if (typeof data === 'string') {
        dialog.prompt({
          title: translations.settings.Inputpassword,
          body: translations.settings.body,
          okText: translations.settings.Import,
          cancelText: translations.settings.Cancel,
          placeholder: translations.settings.Password,
          onConfirm: async (pass) => {
            try {
              const bytes = AES.decrypt(data, pass);
              const result = bytes.toString(Utf8);
              const resultObj = JSON.parse(result);
              await handleChanges(dirPath, dataDir, resultObj, storage);
            } catch (error) {
              showAlert(translations.settings.Invalidpassword);
            }
          },
        });
      } else {
        await handleChanges(dirPath, dataDir, data, storage);
      }
    };

    const changelogPath = path.join(defaultPath, 'changelog.json');
    let changelog = { changes: [] };

    try {
      // Load the changelog
      changelog = await ipcRenderer.callMain('fs:read-json', changelogPath);
    } catch {
      console.error('No changelog file found. Starting fresh.');
    }

    const lastExportDate = changelog.changes.length
      ? new Date(changelog.changes[changelog.changes.length - 1].date)
      : null;

    // Read today's data.json
    try {
      const { data } = await ipcRenderer.callMain(
        'fs:read-json',
        path.join(dirPath, 'data.json')
      );

      if (!data) return showAlert(translations.settings.invaliddata);

      await importData(data);

      // Handle incremental changes based on the changelog
      if (lastExportDate) {
        const changedFiles = changelog.changes
          .filter((entry) => new Date(entry.date) > lastExportDate)
          .flatMap((entry) => entry.files);

        for (const file of new Set(changedFiles)) {
          const sourceFilePath = path.join(dirPath, file); // Get today's folder
          const destPath = file.includes('notes-assets')
            ? path.join(dataDir, 'notes-assets', path.basename(file))
            : file.includes('file-assets')
            ? path.join(dataDir, 'file-assets', path.basename(file))
            : null;

          if (destPath) {
            await ipcRenderer.callMain('fs:copy', {
              path: sourceFilePath,
              dest: destPath,
            });
            console.log(`Imported file: ${file}`);
          }
        }
      }
    } catch (error) {
      notification({
        title: translations.sidebar.notification,
        body: translations.sidebar.importFail,
      });
      console.error('Error while importing data:', error);
    }
  } catch (error) {
    notification({
      title: translations.sidebar.notification,
      body: translations.sidebar.importFail,
    });
    console.error('Error while importing data:', error);
  }
}

// Helper function to handle the changes
async function handleChanges(dirPath, dataDir, resultObj, storage) {
  try {
    const importedLockedStatus = resultObj['lockStatus'];
    const importedIsLocked = resultObj['isLocked'];

    if (importedLockedStatus !== null && importedLockedStatus !== undefined) {
      localStorage.setItem('lockStatus', JSON.stringify(importedLockedStatus));
    }

    if (importedIsLocked !== null && importedIsLocked !== undefined) {
      localStorage.setItem('isLocked', JSON.stringify(importedIsLocked));
    }

    await ipcRenderer.callMain('fs:copy', {
      path: path.join(dirPath, 'assets'),
      dest: path.join(dataDir, 'notes-assets'),
    });
    await ipcRenderer.callMain('fs:copy', {
      path: path.join(dirPath, 'file-assets'),
      dest: path.join(dataDir, 'file-assets'),
    });

    console.log('Assets copied successfully.');

    const keys = [
      { key: 'notes', dfData: {} },
      { key: 'labels', dfData: [] },
    ];

    for (const { key, dfData } of keys) {
      const currentData = await storage.get(key, dfData);
      const importedData = resultObj[key] ?? dfData;
      const mergedData =
        Array.isArray(currentData) && Array.isArray(importedData)
          ? [...new Set([...currentData, ...importedData])]
          : { ...currentData, ...importedData };

      await storage.set(key, mergedData);
    }

    console.log('Data merged successfully.');
  } catch (error) {
    console.error('Error merging imported data:', error);
  }
}
