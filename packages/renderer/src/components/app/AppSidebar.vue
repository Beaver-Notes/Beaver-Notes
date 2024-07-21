<template>
  <aside
    class="w-16 text-gray-600 dark:text-[color:var(--selected-dark-text)] bg-[#F8F8F7] dark:bg-[#353333] fixed text-center flex flex-col items-center h-full left-0 top-0 z-40 py-4 no-print"
  >
    <!-- Sidebar top icons-->
    <button
      v-tooltip:right="
        translations.sidebar.addNotes + ' (' + keyBinding + '+N)'
      "
      class="transition p-2 mb-4 text-primary bg-input rounded-lg"
      @click="addNote"
    >
      <v-remixicon name="riAddFill" />
    </button>
    <button
      v-tooltip:right="
        translations.sidebar.Editednote + ' (' + keyBinding + '+Shift+W)'
      "
      class="transition dark:hover:text-[color:var(--selected-dark-text)] hover:text-gray-800 p-2 mb-4"
      :class="{ 'text-primary': $route.name === 'Note' }"
      @click="openLastEdited"
    >
      <v-remixicon name="riEditLine" />
    </button>
    <button
      v-for="nav in navs"
      :key="nav.name"
      v-tooltip:right="
        `${nav.name} (${nav.shortcut.replace('mod', keyBinding)})`
      "
      :class="{
        'text-primary dark:text-secondary': $route.fullPath === nav.path,
      }"
      class="transition dark:hover:text-[color:var(--selected-dark-text)] hover:text-gray-800 p-2 mb-4"
      @click="handleNavigation(nav)"
    >
      <v-remixicon :name="nav.icon" />
    </button>
    <!-- Navbar bottom icons -->
    <div class="flex-grow"></div>
    <button
      v-tooltip:right="
        translations.sidebar.toggleexport + ' (' + keyBinding + '+Shift+E)'
      "
      class="transition p-2 mb-4"
      @click="exportData"
    >
      <v-remixicon name="riUpload2Line" />
    </button>
    <button
      v-tooltip:right="
        translations.sidebar.toggleimport + ' (' + keyBinding + '+Shift+I)'
      "
      class="transition p-2 mb-4"
      @click="importData"
    >
      <v-remixicon name="riDownload2Line" />
    </button>
    <button
      v-tooltip:right="
        translations.sidebar.toggledarktheme + ' (' + keyBinding + '+Shift+L)'
      "
      :class="[theme.isDark() ? 'text-primary' : '']"
      class="transition p-2 mb-4"
      @click="theme.setTheme(theme.isDark() ? 'light' : 'dark')"
    >
      <v-remixicon :name="theme.isDark() ? 'riSunLine' : 'riMoonClearLine'" />
    </button>
    <router-link
      v-tooltip:right="translations.settings.title + ' (' + keyBinding + '+,)'"
      to="/settings"
      class="transition dark:hover:text-[color:var(--selected-dark-text)] hover:text-gray-800 p-2"
      active-class="text-primary dark:text-secondary"
    >
      <v-remixicon name="riSettingsLine" />
    </router-link>
  </aside>
</template>

<script>
import { shallowReactive, onUnmounted, onMounted, computed } from 'vue';
import { useTheme } from '@/composable/theme';
import { useRouter } from 'vue-router';
import emitter from 'tiny-emitter/instance';
import Mousetrap from '@/lib/mousetrap';
import { useNoteStore } from '@/store/note';
import { useStorage } from '@/composable/storage';
import { useDialog } from '@/composable/dialog';
import { AES } from 'crypto-es/lib/aes';
import { Utf8 } from 'crypto-es/lib/core';
import dayjs from '@/lib/dayjs';
import { onClose } from '../../composable/onClose';

export default {
  setup() {
    const { ipcRenderer, path, notification } = window.electron;
    const theme = useTheme();
    const router = useRouter();
    const dialog = useDialog();
    const noteStore = useNoteStore();
    const storage = useStorage();
    const defaultPath = localStorage.getItem('default-path');

    const isMacOS = navigator.platform.toUpperCase().includes('MAC');
    const keyBinding = isMacOS ? 'Cmd' : 'Ctrl';

    function showAlert(message, options = {}) {
      ipcRenderer.callMain('dialog:message', {
        type: 'error',
        title: 'Alert',
        message,
        ...options,
      });
    }

    const state = shallowReactive({
      dataDir: '',
      password: '',
      fontSize: '16',
      withPassword: false,
      lastUpdated: null,
    });

    const navs = computed(() => [
      {
        name: translations.sidebar.Notes,
        path: '/',
        icon: 'riBookletLine',
        shortcut: 'mod+shift+n',
        action: () => {
          // Add your pre-action logic here
          console.log('Pre-action logic for Notes navigation');
          router.push('/');
        },
      },
      {
        name: translations.sidebar.Archive,
        path: '/?archived=true',
        icon: 'riArchiveDrawerLine',
        shortcut: 'mod+shift+a',
        action: () => {
          // Add your pre-action logic here
          console.log('Pre-action logic for Archive navigation');
          router.push('/?archived=true');
        },
      },
    ]);

    const shortcuts = {
      'mod+n': addNote,
      'mod+,': openSettings,
      'mod+shift+w': openLastEdited,
      'mod+shift+n': () => router.push('/'),
      'mod+shift+a': () => router.push('/?archived=true'),
      'mod+shift+l': () => theme.setTheme(theme.isDark() ? 'light' : 'dark'),
      'mod+shift+u': importData,
      'mod+shift+e': exportData,
    };

    emitter.on('new-note', addNote);
    emitter.on('open-settings', openSettings);

    Mousetrap.bind(Object.keys(shortcuts), (event, combo) => {
      shortcuts[combo]();
    });

    function openSettings() {
      router.push('/settings');
    }
    function openLastEdited() {
      const noteId = localStorage.getItem('lastNoteEdit');

      if (noteId) router.push(`/note/${noteId}`);
    }
    function addNote() {
      noteStore.add().then(({ id }) => {
        router.push(`/note/${id}`);
      });
    }

    if (typeof window !== 'undefined') {
      window.addNote = addNote;
    }

    // import & export

    async function exportData() {
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
          const backupFiles = files.filter((file) =>
            file.endsWith('.json.bak')
          );

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
              const oldFilesPath = path.join(
                folderPath,
                sortedBackupFiles[i].file
              );
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
        notification({
          title: translations.sidebar.notification,
          body: translations.sidebar.exportSuccess,
        });
      } catch (error) {
        notification({
          title: translations.sidebar.notification,
          body: translations.sidebar.exportFail,
        });
        console.error(error);
      }
    }

    async function mergeImportedData(data) {
      try {
        const keys = [
          { key: 'notes', dfData: {} },
          { key: 'labels', dfData: [] },
        ];

        for (const { key, dfData } of keys) {
          const currentData = await storage.get(key, dfData);
          const importedData = data[key] ?? dfData;
          let mergedData;

          if (key === 'labels') {
            const mergedArr = [...currentData, ...importedData];

            mergedData = [...new Set(mergedArr)];
          } else {
            mergedData = { ...currentData, ...importedData };
          }

          await storage.set(key, mergedData);
        }
      } catch (error) {
        console.error(error);
      }
    }

    async function importData() {
      try {
        let today = dayjs();
        let folderName = today.format('[Beaver Notes] YYYY-MM-DD');
        let dirPath = path.join(defaultPath, folderName);

        try {
          let { data } = await ipcRenderer.callMain(
            'fs:read-json',
            path.join(dirPath, 'data.json')
          );

          if (!data) return showAlert(translations.settings.invaliddata);

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
                  const importedDefaultPath = data['dataDir'];
                  const importedLockedStatus = data['lockStatus'];
                  const importedLockedNotes = data['lockedNotes'];
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

                  if (
                    importedLockedNotes !== null &&
                    importedLockedNotes !== undefined
                  ) {
                    localStorage.setItem(
                      'lockedNotes',
                      JSON.stringify(importedLockedNotes)
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
                  window.location.reload();
                } catch (error) {
                  showAlert(translations.settings.Invalidpassword);
                  return false;
                }
              },
            });
          } else {
            await mergeImportedData(data); // Wait for merge operation to finish
            console.log('Data merged successfully.');
            window.location.reload();
          }
        } catch (error) {
          today = today.subtract(1, 'day');
          folderName = today.format('[Beaver Notes] YYYY-MM-DD');
          dirPath = path.join(defaultPath, folderName);

          if (today.isBefore('YYYY-MM-DD')) {
            console.error('No data available for syncing.');
            return;
          }
        }
        notification({
          title: translations.sidebar.notification,
          body: translations.sidebar.importSuccess,
        });
      } catch (error) {
        notification({
          title: translations.sidebar.notification,
          body: translations.sidebar.importFail,
        });
        console.error('Error while importing data:', error);
      }
    }

    // auto sync

    const autoSync = localStorage.getItem('autoSync');

    const handleNavigation = async (nav) => {
      if (autoSync === 'true') {
        await syncexportData(); // Wait for syncexportData() to complete if autoSync is true
      }
      router.push(nav.path);
    };

    async function syncexportData() {
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
          const backupFiles = files.filter((file) =>
            file.endsWith('.json.bak')
          );

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
              const oldFilesPath = path.join(
                folderPath,
                sortedBackupFiles[i].file
              );
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

    onClose(exportAndQuit);

    async function exportAndQuit() {
      const autoSync = localStorage.getItem('autoSync');

      if (autoSync === 'true') {
        await syncexportData();
      }
    }

    async function syncimportData() {
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
                  const importedDefaultPath = data['dataDir'];
                  const importedLockedStatus = data['lockStatus'];
                  const importedLockedNotes = data['lockedNotes'];
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

                  if (
                    importedLockedNotes !== null &&
                    importedLockedNotes !== undefined
                  ) {
                    localStorage.setItem(
                      'lockedNotes',
                      JSON.stringify(importedLockedNotes)
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

    console.log('Default path from local storage:', defaultPath);

    onUnmounted(() => {
      emitter.off('new-note', addNote);
      emitter.off('open-settings', openSettings);
      state.dataDir = defaultPath;
    });

    const translations = shallowReactive({
      sidebar: {
        addNotes: 'sidebar.addNotes',
        Editednote: 'sidebar.Editednote',
        toggleexport: 'sidebar.toggleexport',
        toggleimport: 'sidebar.toggleimport',
        toggledarktheme: 'sidebar.toggledarktheme',
        Notes: 'sidebar.Notes',
        Archive: 'sidebar.Archive',
        notification: 'sidebar.notification',
        exportSuccess: 'sidebar.exportSuccess',
        importSuccess: 'sidebar.importSuccess',
        exportFail: 'sidebar.exportFail',
        importFail: 'sidebar.importFail',
      },
      settings: {
        title: 'settings.title',
        Inputpassword: 'settings.Inputpassword',
        body: 'settings.body',
        Import: 'settings.Import',
        Cancel: 'settings.Cancel',
        Password: 'settings.Password',
        invaliddata: 'settings.invaliddata',
        Invalidpassword: 'settings.Invalidpassword',
      },
    });

    onMounted(async () => {
      // Load translations
      const loadedTranslations = await loadTranslations();
      if (loadedTranslations) {
        Object.assign(translations, loadedTranslations);
      }
      const autoSync = localStorage.getItem('autoSync');

      if (autoSync === 'true') {
        await syncimportData();
      }
    });

    const loadTranslations = async () => {
      const selectedLanguage = localStorage.getItem('selectedLanguage') || 'en';
      try {
        const translationModule = await import(
          `../../pages/settings/locales/${selectedLanguage}.json`
        );
        return translationModule.default;
      } catch (error) {
        console.error('Error loading translations:', error);
        return null;
      }
    };

    return {
      navs,
      translations,
      theme,
      addNote,
      noteStore,
      syncimportData,
      syncexportData,
      openLastEdited,
      keyBinding,
      handleNavigation,
      exportData,
      importData,
    };
  },
};
</script>
<style>
@media print {
  .no-print {
    visibility: hidden;
  }
}
</style>
