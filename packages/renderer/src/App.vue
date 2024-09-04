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
import { useRouter } from 'vue-router';
import { useTheme } from './composable/theme';
import { useStore } from './store';
import { useNoteStore } from './store/note';
import { useLabelStore } from './store/label';
import { io } from 'socket.io-client';
import notes from './utils/notes';
import AppSidebar from './components/app/AppSidebar.vue';
import AppCommandPrompt from './components/app/AppCommandPrompt.vue';
import { useDialog } from './composable/dialog';
import Mousetrap from '@/lib/mousetrap';
import { useClipboard } from './composable/clipboard';
import { useAppStore } from './store/app';
import { useTranslation } from './composable/translations';
import { t } from './utils/translations';

export default {
  components: { AppSidebar, AppCommandPrompt },
  setup() {
    const theme = useTheme();
    const store = useStore();
    const router = useRouter();
    const noteStore = useNoteStore();
    const labelStore = useLabelStore();

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

    const setupSocket = () => {
      const socket = io('http://localhost:3000');
      const noteStore = useNoteStore();

      socket.on('newNote', (note) => {
        noteStore.add(note).then((newNote) => {
          console.log('Note received and added:', newNote);
        });
      });

      socket.on('deleteNote', async (id) => {
        try {
          const deletedNoteId = await noteStore.delete(id);
          console.log('Note deleted:', deletedNoteId);
        } catch (error) {
          console.error(error);
        }
      });

      socket.on('addLabel', async ({ id, labelId }) => {
        try {
          const addedLabelId = await noteStore.addLabel(id, labelId);
          console.log('Label added to note:', addedLabelId);
        } catch (error) {
          console.error(error);
        }
      });

      socket.on('connect_error', (error) => {
        console.error('Socket.IO Error:', error);
      });
    };

    const appStore = useAppStore();
    const translations = ref({ dialog: {} });
    const requestAuth = (data) => {
      const dialog = useDialog();
      const trans = translations.value;
      dialog.auth({
        body: t(trans.dialog.confirmGrantPermission, {
          platform: data.platform,
        }),
        auth: data.auth || [],
        label: t(trans.dialog.tokenName),
        allowedEmpty: false,
        onConfirm: async ({ name, auths }) => {
          const token = await window.electron.createToken({
            id: data.id,
            platform: data.platform,
            name,
            auth: auths,
          });
          appStore.updateFromStorage();
          dialog.confirm({
            body: `Token: ${token}`,
            okText: t(trans.dialog.copy),
            onConfirm: () => {
              const { copyToClipboard } = useClipboard();
              copyToClipboard(token);
            },
          });
        },
      });
    };

    onMounted(async () => {
      await useTranslation().then((trans) => {
        if (trans) {
          translations.value = trans;
        }
      });
    });

    onMounted(async () => {
      setupSocket();
      await appStore.updateFromStorage();
      window.electron.setRequestAuthConfirm(requestAuth);
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

      const lastNoteEdit = localStorage.getItem('lastNoteEdit');

      if (lastNoteEdit) {
        router.push(`/note/${lastNoteEdit}`);
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

    onMounted(() => {
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
