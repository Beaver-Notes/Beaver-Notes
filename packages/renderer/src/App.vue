<template>
  <app-command-prompt />
  <app-sidebar v-show="!store.inReaderMode" />
  <div
    v-show="store.inReaderMode"
    class="fixed top-0 left-0 w-full h-full pointer-events-none z-50"
  ></div>

  <div
    v-show="updateBanner.show"
    class="flex fixed bottom-0 mx-auto align-center items-center w-full z-50"
  >
    <ui-banner
      :content="updateBanner.content"
      :primary-text="updateBanner.primaryText"
      :secondary-text="updateBanner.secondaryText"
      @button-1="handleUpdateInstall"
      @button-2="handleUpdateDismiss"
    />
  </div>

  <main v-if="retrieved" :class="{ 'pl-16 print:p-2': !store.inReaderMode }">
    <router-view />
  </main>
  <div
    v-show="appStore.loading"
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
import notes from './utils/notes';
import AppSidebar from './components/app/AppSidebar.vue';
import AppCommandPrompt from './components/app/AppCommandPrompt.vue';
import Mousetrap from '@/lib/mousetrap';
import { useAppStore } from './store/app';
import { useTranslation } from './composable/translations';
import { importBEA } from './utils/share/BEA';

export default {
  components: {
    AppSidebar,
    AppCommandPrompt,
  },
  setup() {
    const { onFileOpened } = window.electron;
    const theme = useTheme();
    const store = useStore();
    const router = useRouter();
    const noteStore = useNoteStore();
    const labelStore = useLabelStore();
    const retrieved = ref(false);

    // Update banner state
    const updateBanner = reactive({
      show: false,
      content: '',
      primaryText: '',
      secondaryText: '',
      version: '',
    });

    const selectedFont = localStorage.getItem('selected-font') || 'Arimo';
    const selectedCodeFont =
      localStorage.getItem('selected-font-code') || 'JetBrains Mono';
    const selectedDarkText =
      localStorage.getItem('selected-dark-text') || 'white';
    const colorScheme = localStorage.getItem('color-scheme') || 'light';
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
    document.documentElement.classList.add(colorScheme);
    document.documentElement.style.setProperty('--selected-width', editorWidth);

    const zoom = async () => {
      const zoomLevel = localStorage.getItem('zoomLevel');
      if (!zoomLevel) {
        localStorage.setItem('zoomLevel', '1.0');
        window.electron.ipcRenderer.callMain('app:set-zoom', 1.0);
      }
    };

    const appStore = useAppStore();
    const translations = ref({ dialog: {}, settings: {} });

    // Handle update banner actions
    const handleUpdateInstall = () => {
      window.electron.ipcRenderer.callMain('install-update');
      updateBanner.show = false;
    };

    const handleUpdateDismiss = () => {
      updateBanner.show = false;
    };

    // Listen for update banner events
    const setupUpdateListeners = () => {
      if (window.electron && window.electron.ipcRenderer) {
        const handleUpdateBanner = (bannerData) => {
          updateBanner.content = bannerData.content;
          updateBanner.primaryText = bannerData.primaryText;
          updateBanner.secondaryText = bannerData.secondaryText;
          updateBanner.version = bannerData.version;
          updateBanner.show = true;
        };

        // Store the handler so we can access it
        window.handleUpdateBanner = handleUpdateBanner;
      }
    };

    onMounted(async () => {
      await useTranslation().then((trans) => {
        if (trans) {
          translations.value = trans;
        }
      });

      document.body.style.zoom = state.zoomLevel;

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

      setupUpdateListeners();

      // Notify main process that renderer is ready
      try {
        await window.electron.ipcRenderer.callMain('renderer-ready');
      } catch (error) {
        console.error(
          'Error notifying main process that renderer is ready:',
          error
        );
      }

      // Check for updates if auto-update is enabled
      try {
        const autoUpdateEnabled = await window.electron.ipcRenderer.callMain(
          'get-auto-update-status'
        );

        if (autoUpdateEnabled) {
          // Add a small delay to ensure everything is fully initialized
          setTimeout(async () => {
            await window.electron.ipcRenderer.callMain('check-for-updates');
          }, 1000);
        }
      } catch (error) {
        console.error('Error checking auto-update status:', error);
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

    onFileOpened(async (path) => {
      await router.isReady();
      while (!retrieved.value) await new Promise((r) => setTimeout(r, 100));
      if (await importBEA(path, router, store))
        console.log('Import + navigation OK');
    });

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
      document.body.style.zoom = state.zoomLevel;
    };

    return {
      state,
      setZoom,
      store,
      retrieved,
      zoom,
      appStore,
      updateBanner,
      handleUpdateInstall,
      handleUpdateDismiss,
    };
  },
};
</script>
