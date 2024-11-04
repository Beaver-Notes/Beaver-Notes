<template>
  <app-command-prompt />
  <app-sidebar v-if="!store.inFocusMode" />
  <div
    v-if="store.inFocusMode"
    class="fixed top-0 left-0 w-full h-full border-8 pointer-events-none z-50"
  ></div>
  <main v-if="retrieved" :class="{ 'pl-16': !store.inFocusMode }">
    <router-view />
  </main>
  <div
    v-if="appStore.loading"
    class="fixed w-full h-full top-0 left-0 z-50 flex justify-center items-center bg-opacity-40 bg-black"
  >
    <ui-spinner :size="50" />
  </div>
  <ui-dialog />
</template>
<script>
import { ref, onMounted, onUnmounted, reactive } from 'vue';
const { ipcRenderer, path } = window.electron;
import { useDialog } from '@/composable/dialog';
import { AES } from 'crypto-es/lib/aes';
import { Utf8 } from 'crypto-es/lib/core';
import { useStorage } from '@/composable/storage';
import { useRouter } from 'vue-router';
import { useTheme } from './composable/theme';
import { useStore } from './store';
import { useNoteStore } from './store/note';
import { useLabelStore } from './store/label';
import notes from './utils/notes';
import AppSidebar from './components/app/AppSidebar.vue';
import AppCommandPrompt from './components/app/AppCommandPrompt.vue';
import Mousetrap from '@/lib/mousetrap';
import { useAppStore } from './store/app';
import { useTranslation } from './composable/translations';

export default {
  components: { AppSidebar, AppCommandPrompt },
  setup() {
    const theme = useTheme();
    const store = useStore();
    const storage = useStorage();
    const router = useRouter();
    const noteStore = useNoteStore();
    const labelStore = useLabelStore();
    const dialog = useDialog();
    const retrieved = ref(false);

    const selectedFont = localStorage.getItem('selected-font') || 'Arimo';
    const selectedCodeFont =
      localStorage.getItem('selected-font-code') || 'JetBrains Mono';
    const selectedDarkText =
      localStorage.getItem('selected-dark-text') || 'white';
    const editorWidth = localStorage.getItem('editorWidth') || '54rem';
    document.documentElement.style.setProperty('--selected-font', selectedFont);
    document.documentElement.style.setProperty(
      '--selected-font-code',
      selectedCodeFont
    );
    document.documentElement.style.setProperty(
      '--selected-dark-text',
      selectedDarkText
    );
    document.documentElement.style.setProperty('--selected-width', editorWidth);

    const zoom = async () => {
      // Check if zoom level exists in localStorage
      const zoomLevel = localStorage.getItem('zoomLevel');

      // If zoom level doesn't exist in localStorage, set it to 1.0
      if (!zoomLevel) {
        localStorage.setItem('zoomLevel', '1.0');

        // Send message to main process to set zoom level
        window.electron.ipcRenderer.callMain('app:set-zoom', 1.0);
      }
    };

    const appStore = useAppStore();
    const translations = ref({ dialog: {} });

    async function importNoteFromBea(filePath) {
      try {
        // Read the .bea file
        const fileContent = await ipcRenderer.callMain(
          'fs:read-json',
          filePath
        );
        if (!fileContent || !fileContent.data) {
          throw new Error('Invalid file format');
        }

        let noteData;
        // Try parsing the data field directly first
        try {
          noteData = JSON.parse(fileContent.data);
        } catch (e) {
          // If parsing fails, it might be encrypted
          return new Promise((resolve, reject) => {
            dialog.prompt({
              title: 'Import Protected Note',
              body: 'This note is password protected. Please enter the password to import.',
              okText: 'Import',
              cancelText: 'Cancel',
              placeholder: 'Password',
              onConfirm: async (password) => {
                try {
                  // Decrypt the data
                  const bytes = AES.decrypt(fileContent.data, password);
                  const decrypted = bytes.toString(Utf8);
                  noteData = JSON.parse(decrypted);
                  await processImportedNote(noteData);
                  resolve(true);
                  return true;
                } catch (error) {
                  alert('Invalid password or corrupted file.');
                  reject(error);
                  return false;
                }
              },
              onCancel: () => {
                resolve(false);
              },
            });
          });
        }

        processImportedNote(noteData);
        localStorage.removeItem('openFilePath');
        window.location.reload();
      } catch (error) {
        console.error('Error importing note:', error);
        alert(
          'Failed to import note. The file may be corrupted or in an invalid format.'
        );
      }
    }

    async function processImportedNote(noteData) {
      try {
        // Get current storage data
        const currentNotes = await storage.get('notes', {});
        const dataDir = await storage.get('dataDir', '', 'settings');

        // Update notes storage
        const updatedNotes = {
          ...currentNotes,
          [noteData.id]: {
            id: noteData.id,
            title: noteData.title,
            content: noteData.content,
          },
        };
        await storage.set('notes', updatedNotes);

        // Update locked notes if present and not null
        if (noteData.lockedNotes) {
          localStorage.setItem(
            'lockedNotes',
            JSON.stringify(noteData.lockedNotes)
          );
        }

        // Process assets if present
        if (noteData.assets) {
          // Create directories if they don't exist
          await ipcRenderer.callMain(
            'fs:mkdir',
            path.join(dataDir, 'notes-assets', noteData.id)
          );
          await ipcRenderer.callMain(
            'fs:mkdir',
            path.join(dataDir, 'file-assets', noteData.id)
          );

          // Process notes assets
          for (const [filename, base64Data] of Object.entries(
            noteData.assets.notesAssets || {}
          )) {
            const binaryString = atob(base64Data);
            const byteArray = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              byteArray[i] = binaryString.charCodeAt(i);
            }
            await ipcRenderer.callMain('fs:writeFile', {
              path: path.join(dataDir, 'notes-assets', noteData.id, filename),
              data: byteArray.buffer,
            });
          }

          // Process file assets
          for (const [filename, base64Data] of Object.entries(
            noteData.assets.fileAssets || {}
          )) {
            const binaryString = atob(base64Data);
            const byteArray = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              byteArray[i] = binaryString.charCodeAt(i);
            }
            await ipcRenderer.callMain('fs:writeFile', {
              path: path.join(dataDir, 'file-assets', noteData.id, filename),
              data: byteArray.buffer,
            });
          }
        }

        alert(`Note "${noteData.title}" imported successfully.`);
      } catch (error) {
        console.error('Error processing imported note:', error);
        throw error;
      }
    }

    onMounted(async () => {
      await useTranslation().then((trans) => {
        if (trans) {
          translations.value = trans;
        }
      });
      const filePath = localStorage.getItem('openFilePath');
      if (filePath) {
        console.log(filePath);
        await importNoteFromBea(filePath);
      }
      // Apply the stored zoom level on mount
      document.body.style.zoom = state.zoomLevel;

      // Detect platform and apply shortcuts for Windows and Linux only
      const platform = navigator.userAgent.toLowerCase();
      const isWindowsOrLinux =
        platform.includes('win') || platform.includes('linux');

      if (isWindowsOrLinux) {
        Mousetrap.bind(['ctrl+=', 'ctrl+plus'], () => {
          setZoom(Math.min(parseFloat(state.zoomLevel) + 0.1, 3.0));
        });

        Mousetrap.bind('ctrl+-', () => {
          setZoom(Math.max(parseFloat(state.zoomLevel) - 0.1, 0.5));
        });

        Mousetrap.bind('ctrl+0', () => {
          setZoom(1.0);
        });
      }
    });

    onUnmounted(() => {
      appStore.updateToStorage();
    });

    const isFirstTime = localStorage.getItem('first-time');

    if (!isFirstTime) {
      const promises = Promise.allSettled(
        Object.values(notes).map(({ title, content, id }) =>
          noteStore.add({ id, title, content: JSON.parse(content) })
        )
      );

      labelStore.add('Introduction');
      labelStore.add('Tutorial');

      promises.then(() => {
        const note = noteStore.notes.find(
          ({ title }) => title === 'Welcome to Beaver Notes'
        );

        if (note) router.push(`/note/${note.id}`);

        localStorage.setItem('first-time', false);
        localStorage.setItem('spellcheckEnabled', 'true');
        retrieved.value = true;
      });
    } else {
      store.retrieve().then(() => (retrieved.value = true));

      if (appStore.setting.openLastEdited) {
        const lastNoteEdit = localStorage.getItem('lastNoteEdit');

        if (lastNoteEdit) {
          router.push(`/note/${lastNoteEdit}`);
        }
      }
    }
    theme.loadTheme();
    window.electron.ipcRenderer.callMain(
      'app:set-zoom',
      +localStorage.getItem('zoomLevel') || 1
    );
    window.electron.ipcRenderer.callMain(
      'app:change-menu-visibility',
      localStorage.getItem('visibility-menubar') !== 'true' || false
    );

    const state = reactive({
      zoomLevel: parseFloat(localStorage.getItem('zoomLevel')) || 1.0,
    });

    const setZoom = (newZoomLevel) => {
      window.electron.ipcRenderer.callMain('app:set-zoom', newZoomLevel);
      state.zoomLevel = newZoomLevel.toFixed(1);
      localStorage.setItem('zoomLevel', state.zoomLevel);
      // Apply the zoom level to the document body (or specific container)
      document.body.style.zoom = state.zoomLevel;
    };

    return {
      state,
      setZoom,
      store,
      retrieved,
      zoom,
      appStore,
    };
  },
};
</script>
