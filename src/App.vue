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

  <div
    v-show="syncLockBanner.show"
    class="flex fixed bottom-0 mx-auto align-center items-center w-full z-50"
    :class="updateBanner.show ? 'mb-16' : ''"
  >
    <ui-banner
      :content="syncLockBannerCopy.content"
      :primary-text="syncLockBannerCopy.primaryText"
      :secondary-text="syncLockBannerCopy.secondaryText"
      @button-1="openSyncSettings"
      @button-2="dismissSyncBanner"
    />
  </div>

  <main
    v-if="retrieved"
    data-testid="app-main"
    :class="{ 'pl-16 print:p-2': !store.inReaderMode }"
  >
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
import { ref, onMounted, onUnmounted, reactive, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useTheme } from './composable/theme';
import { useStore } from './store';
import { useNoteStore } from './store/note';
import { useLabelStore } from './store/label';
import { useTranslations } from './composable/useTranslations';
import notes from './utils/notes';
import AppSidebar from './components/app/AppSidebar.vue';
import AppCommandPrompt from './components/app/AppCommandPrompt.vue';
import Mousetrap from '@/lib/mousetrap';
import emitter from 'tiny-emitter/instance';
import { useAppStore } from './store/app';
import { importBEA } from './utils/share/BEA';
import {
  tryRestoreKeyFromSafeStorage,
  syncFolderHasEncryption,
  isSyncKeyLoaded,
} from './utils/syncCrypto';
import { tryRestoreAppKeyFromSafeStorage } from './utils/appCrypto';
import { getSyncPath } from './utils/syncPath';
import { backend, onFileOpened } from '@/lib/tauri-bridge';

export default {
  components: {
    AppSidebar,
    AppCommandPrompt,
  },
  setup() {
    const { translations } = useTranslations();
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
    const syncLockBanner = reactive({
      show: false,
      dismissed: false,
    });
    const syncLockBannerCopy = computed(() => ({
      content:
        translations.value.app?.syncLockContent ||
        'Sync is encrypted but locked on this device. Unlock it in Settings to resume sync.',
      primaryText: translations.value.app?.openSettings || 'Open Settings',
      secondaryText: translations.value.app?.dismiss || 'Dismiss',
    }));

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
        backend.invoke('app:set-zoom', 1.0);
      }
    };

    const appStore = useAppStore();
    let removeRouteGuard = null;
    const unlistenFns = [];

    // Handle update banner actions
    const handleUpdateInstall = () => {
      backend.invoke('install-update');
      updateBanner.show = false;
    };

    const handleUpdateDismiss = () => {
      updateBanner.show = false;
    };

    const openSyncSettings = () => {
      syncLockBanner.show = false;
      router.push('/settings');
    };

    const dismissSyncBanner = () => {
      syncLockBanner.dismissed = true;
      syncLockBanner.show = false;
    };

    const refreshSyncLockBanner = async () => {
      const inSettings = router.currentRoute.value.path.startsWith('/settings');
      if (inSettings || syncLockBanner.dismissed) {
        syncLockBanner.show = false;
        return;
      }

      const folderEncrypted = await syncFolderHasEncryption();
      syncLockBanner.show = folderEncrypted && !isSyncKeyLoaded();
    };

    onMounted(async () => {
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
      unlistenFns.push(
        backend.listen('menu-new-note', () => emitter.emit('new-note')),
        backend.listen('menu-zoom-in', () =>
          setZoom(Math.min(parseFloat(state.zoomLevel) + 0.1, 3.0))
        ),
        backend.listen('menu-zoom-out', () =>
          setZoom(Math.max(parseFloat(state.zoomLevel) - 0.1, 0.5))
        ),
        backend.listen('print-pdf-request', (event, payload) => {
          const pdfName =
            payload?.pdfName || payload?.pdf_name || 'Beaver Notes';
          const previousTitle = document.title;
          const restoreTitle = () => {
            document.title = previousTitle;
            window.removeEventListener('afterprint', restoreTitle);
          };
          window.addEventListener('afterprint', restoreTitle);
          document.title = pdfName;
          window.print();
        }),
        backend.listen('update-banner', (_, bannerData) => {
          updateBanner.content = bannerData.content;
          updateBanner.primaryText = bannerData.primaryText;
          updateBanner.secondaryText = bannerData.secondaryText;
          updateBanner.version = bannerData.version;
          updateBanner.show = true;
        }),
        backend.listen('spellcheck-changed', () => {})
      );

      // Notify the Tauri backend once the app shell is ready.
      try {
        await backend.invoke('app-ready');
      } catch (error) {
        console.error(
          'Error notifying the Tauri backend that the app is ready:',
          error
        );
      }

      // Check for updates if auto-update is enabled
      try {
        const autoUpdateEnabled = await backend.invoke(
          'get-auto-update-status'
        );

        if (autoUpdateEnabled) {
          // Add a small delay to ensure everything is fully initialized
          setTimeout(async () => {
            try {
              await backend.invoke('check-for-updates');
            } catch (error) {
              console.warn('Auto-update check failed:', error);
            }
          }, 1000);
        }
      } catch (error) {
        console.error('Error checking auto-update status:', error);
      }

      void refreshSyncLockBanner();
      removeRouteGuard = router.afterEach(() => {
        void refreshSyncLockBanner();
      });
    });

    onUnmounted(() => {
      appStore.updateToStorage();
      if (removeRouteGuard) removeRouteGuard();
      unlistenFns.forEach((subscription) => {
        Promise.resolve(subscription)
          .then((unlisten) => unlisten?.())
          .catch(() => {});
      });
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
      // Restore encryption keys BEFORE loading notes so _decryptNoteForMemory
      // has the app key available. Without this, notes load as { ae:1 }
      // envelopes because the key hasn't been restored from safeStorage yet
      // when retrieve() runs, and the editor crashes parsing them.
      void (async () => {
        await getSyncPath();
        await Promise.allSettled([
          tryRestoreKeyFromSafeStorage(),
          tryRestoreAppKeyFromSafeStorage(),
        ]);
        await store.retrieve();
        retrieved.value = true;
        await refreshSyncLockBanner();
      })();

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

    backend.invoke('app:set-zoom', +localStorage.getItem('zoomLevel') || 1);
    backend.invoke(
      'app:change-menu-visibility',
      localStorage.getItem('visibility-menubar') !== 'true' || false
    );

    const state = reactive({
      zoomLevel: parseFloat(localStorage.getItem('zoomLevel')) || 1.0,
    });

    const setZoom = (newZoomLevel) => {
      backend.invoke('app:set-zoom', newZoomLevel);
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
      syncLockBanner,
      syncLockBannerCopy,
      openSyncSettings,
      dismissSyncBanner,
    };
  },
};
</script>
