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
    let data = await storage.store();

    if (state.withPassword) {
      data = AES.encrypt(JSON.stringify(data), state.password).toString();
    }

    const folderName = dayjs().format('[Beaver Notes] YYYY-MM-DD');
    const dataDir = await storage.get('dataDir', '', 'settings');
    const exportPath = defaultPath; // Use the selected default path
    const folderPath = path.join(exportPath, folderName);

    const containsGvfs = exportPath.includes('gvfs');

    if (containsGvfs) {
      // Ensure the directory exists
      await ipcRenderer.callMain('fs:ensureDir', folderPath);

      // Save main data.json
      await ipcRenderer.callMain('fs:output-json', {
        path: path.join(folderPath, 'data.json'),
        data: { data },
      });

      // Copy notes-assets
      const notesAssetsSource = path.join(dataDir, 'notes-assets');
      const notesAssetsDest = path.join(folderPath, 'assets');
      await ipcRenderer.callMain('gvfs:copy', {
        path: notesAssetsSource,
        dest: notesAssetsDest,
      });

      // Copy file-assets
      const fileAssetsSource = path.join(dataDir, 'file-assets');
      const fileAssetsDest = path.join(folderPath, 'file-assets');
      await ipcRenderer.callMain('gvfs:copy', {
        path: fileAssetsSource,
        dest: fileAssetsDest,
      });
    } else {
      // Ensure the directory exists
      await ipcRenderer.callMain('fs:ensureDir', folderPath);

      // Save main data.json
      await ipcRenderer.callMain('fs:output-json', {
        path: path.join(folderPath, 'data.json'),
        data: { data },
      });

      const backupFileName = `data_${dayjs().format(
        'YYYYMMDD_HHmmss'
      )}.json.bak`;
      const backupFilePath = path.join(folderPath, backupFileName);

      await ipcRenderer.callMain('fs:copy', {
        path: path.join(folderPath, 'data.json'),
        dest: backupFilePath,
      });

      // Limit the number of backup files to 4
      const files = await ipcRenderer.callMain('fs:readdir', folderPath);
      const backupFiles = files.filter((file) => file.endsWith('.json.bak'));

      if (backupFiles.length > 4) {
        // Sort backup files by creation time
        const sortedBackupFiles = await Promise.all(
          backupFiles.map(async (file) => {
            const backupFilesPath = path.join(folderPath, file);
            const stats = await ipcRenderer.callMain(
              'fs:stat',
              backupFilesPath
            );
            return { file, time: stats.birthtime };
          })
        ).then((files) => files.sort((a, b) => a.time - b.time));

        // Delete oldest files
        for (let i = 0; i < sortedBackupFiles.length - 4; i++) {
          const oldFilesPath = path.join(folderPath, sortedBackupFiles[i].file);
          await ipcRenderer.callMain('fs:unlink', oldFilesPath);
        }
      }

      // Copy notes-assets
      const notesAssetsSource = path.join(dataDir, 'notes-assets');
      const notesAssetsDest = path.join(folderPath, 'assets');
      await ipcRenderer.callMain('fs:copy', {
        path: notesAssetsSource,
        dest: notesAssetsDest,
      });

      // Copy file-assets
      const fileAssetsSource = path.join(dataDir, 'file-assets');
      const fileAssetsDest = path.join(folderPath, 'file-assets');
      await ipcRenderer.callMain('fs:copy', {
        path: fileAssetsSource,
        dest: fileAssetsDest,
      });
    }

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
    let today = dayjs();
    let folderName = today.format('[Beaver Notes] YYYY-MM-DD');
    if (!defaultPath) {
      return;
    }
    let dirPath = path.join(defaultPath, folderName);

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

              await mergeImportedData(resultObj); // Wait for merge operation to finish
              const dataDir = await storage.get('dataDir', '', 'settings');
              const importedDefaultPath = resultObj['dataDir'];
              const importedLockedStatus = resultObj['lockStatus'];
              const importedIsLocked = resultObj['isLocked'];

              localStorage.setItem('dataDir', importedDefaultPath);
              if (
                importedLockedStatus !== null &&
                importedLockedStatus !== undefined
              ) {
                localStorage.setItem(
                  'lockStatus',
                  JSON.stringify(importedLockedStatus)
                );
              }

              if (importedIsLocked !== null && importedIsLocked !== undefined) {
                localStorage.setItem(
                  'isLocked',
                  JSON.stringify(importedIsLocked)
                );
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
            } catch (error) {
              showAlert(translations.settings.Invalidpassword);
              return false;
            }
          },
        });
      } else {
        await mergeImportedData(data); // Wait for merge operation to finish
        console.log('Data merged successfully.');
      }
    };

    try {
      let { data } = await ipcRenderer.callMain(
        'fs:read-json',
        path.join(dirPath, 'data.json')
      );

      if (!data) return showAlert(translations.settings.invaliddata);

      await importData(data);
    } catch (error) {
      today = today.subtract(1, 'day');
      folderName = today.format('[Beaver Notes] YYYY-MM-DD');
      dirPath = path.join(defaultPath, folderName);

      if (today.isBefore('YYYY-MM-DD')) {
        console.error('No data available for syncing.');
        return;
      }

      try {
        let { data } = await ipcRenderer.callMain(
          'fs:read-json',
          path.join(dirPath, 'data.json')
        );

        if (!data) return showAlert(translations.settings.invaliddata);

        await importData(data);
      } catch (error) {
        notification({
          title: translations.sidebar.notification,
          body: translations.sidebar.importFail,
        });
        console.error('Error while importing data:', error);
      }
    }
  } catch (error) {
    notification({
      title: translations.sidebar.notification,
      body: translations.sidebar.importFail,
    });
    console.error('Error while importing data:', error);
  }
}

async function mergeImportedData(data) {
  const storage = useStorage();
  try {
    const keys = [
      { key: 'notes', dfData: {} },
      { key: 'labels', dfData: [] },
      { key: 'lockStatus', dfData: {} },
      { key: 'isLocked', dfData: {} }, // Add isLocked to handle imported locked status
    ];

    for (const { key, dfData } of keys) {
      const currentData = await storage.get(key, dfData);
      const importedData = data[key] ?? dfData;
      let mergedData;

      if (key === 'labels') {
        const mergedArr = [...currentData, ...importedData];
        mergedData = [...new Set(mergedArr)];
      } else if (key === 'lockStatus' || key === 'isLocked') {
        mergedData = { ...currentData, ...importedData };
      } else {
        mergedData = { ...currentData, ...importedData };
      }

      await storage.set(key, mergedData);
    }
  } catch (error) {
    console.error('Error merging imported data:', error);
  }
}
