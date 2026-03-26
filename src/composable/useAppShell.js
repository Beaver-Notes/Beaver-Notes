import { onMounted, onUnmounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTheme } from './theme';
import { useStorage } from './storage';
import { getSettingSync, hydrateSettingsStore, setSetting } from './settings';
import { useStore } from '@/store';
import { useTranslations } from './useTranslations';
import Mousetrap from '@/lib/mousetrap';
import emitter from 'tiny-emitter/instance';
import { useAppStore } from '@/store/app';
import { useAppShellLayout } from './useAppShellLayout';
import { useAppShellBanners } from './useAppShellBanners';
import { importBEA } from '@/utils/share/BEA';
import { tryRestoreKeyFromSafeStorage } from '@/utils/syncCrypto';
import { tryRestoreAppKeyFromSafeStorage } from '@/utils/appCrypto';
import { getSyncPath } from '@/utils/syncPath';
import { backend, onFileOpened } from '@/lib/tauri-bridge';
import { appReady, setMenuVisibility, setZoomLevel } from '@/lib/native/app';
import {
  checkForUpdates,
  getAutoUpdateStatus,
  installUpdate,
} from '@/lib/native/updates';
import { getStoredZoomLevel, setStoredZoomLevel } from './zoom';

const ONBOARDING_ROUTE_NAME = 'Onboarding';

function applyDocumentSettings() {
  document.documentElement.style.setProperty(
    '--selected-font',
    getSettingSync('selectedFont')
  );
  document.documentElement.style.setProperty(
    '--selected-font-code',
    getSettingSync('selectedCodeFont')
  );
  document.documentElement.style.setProperty(
    '--selected-dark-text',
    getSettingSync('selectedDarkText')
  );
  document.documentElement.classList.add(getSettingSync('colorScheme'));
  document.documentElement.style.setProperty(
    '--selected-width',
    getSettingSync('editorWidth')
  );
}

export function useAppShell() {
  const { translations } = useTranslations();
  const theme = useTheme();
  const store = useStore();
  const route = useRoute();
  const router = useRouter();
  const settingsStorage = useStorage('settings');
  const dataStorage = useStorage('data');
  const appStore = useAppStore();

  const retrieved = ref(false);
  const animateRouteChange = ref(true);
  const state = reactive({
    zoomLevel: getStoredZoomLevel().toFixed(1),
  });
  const {
    bottomBannerStyle,
    initializeMobileKeyboardTracking,
    initializeSafeAreaInsets,
    mainStyle,
    mobileNavbarStyle,
    showMobileNavbar,
    showSidebar,
  } = useAppShellLayout({
    backend,
    route,
    store,
  });
  const {
    dismissSyncBanner,
    handleUpdateDismiss,
    handleUpdateInstall,
    openSyncSettings,
    refreshSyncLockBanner,
    syncLockBanner,
    syncLockBannerCopy,
    updateBanner,
  } = useAppShellBanners({
    route,
    router,
    translations,
  });

  let removeRouteGuard = null;
  let removeBeforeRouteGuard = null;
  const unlistenFns = [];

  applyDocumentSettings();

  const getTopLevelRouteKey = (viewRoute) =>
    viewRoute?.fullPath || viewRoute?.path || route.fullPath;

  const setZoom = (newZoomLevel) => {
    state.zoomLevel = setStoredZoomLevel(newZoomLevel, {
      syncDocument: true,
    });
  };

  const updateZoomBy = (delta) => {
    const currentZoomLevel = parseFloat(state.zoomLevel);
    const nextZoomLevel = Math.min(Math.max(currentZoomLevel + delta, 0.5), 3);
    setZoom(nextZoomLevel);
  };

  const restoreEncryptionKeys = async () => {
    await getSyncPath();
    await Promise.allSettled([
      tryRestoreKeyFromSafeStorage(),
      tryRestoreAppKeyFromSafeStorage(),
    ]);
  };

  const hasExistingWorkspaceData = async () => {
    const [notesData, foldersData] = await Promise.all([
      dataStorage.get('notes', {}),
      dataStorage.get('folders', {}),
    ]);

    return (
      Object.keys(notesData || {}).length > 0 ||
      Object.keys(foldersData || {}).length > 0
    );
  };

  const initializeWorkspace = async () => {
    await hydrateSettingsStore();
    await setSetting('spellcheckEnabled', getSettingSync('spellcheckEnabled'));

    const [hasData, onboardingCompleted] = await Promise.all([
      hasExistingWorkspaceData(),
      settingsStorage.get('onboardingCompleted', false),
    ]);

    if (!hasData && !onboardingCompleted) {
      retrieved.value = true;
      if (route.name !== ONBOARDING_ROUTE_NAME) {
        await router.replace('/onboarding');
      }
      return;
    }

    await restoreEncryptionKeys();
    await store.retrieve();
    retrieved.value = true;
    await refreshSyncLockBanner();

    if (appStore.setting.openLastEdited) {
      const lastNoteEdit = localStorage.getItem('lastNoteEdit');
      if (lastNoteEdit && route.name !== ONBOARDING_ROUTE_NAME) {
        router.push(`/note/${lastNoteEdit}`);
      }
    }
  };

  onMounted(async () => {
    document.body.style.zoom = state.zoomLevel;

    const platform = navigator.userAgent.toLowerCase();
    const isWindowsOrLinux =
      platform.includes('win') || platform.includes('linux');

    if (isWindowsOrLinux) {
      Mousetrap.bind(['ctrl+=', 'ctrl+plus'], () => {
        updateZoomBy(0.1);
      });

      Mousetrap.bind('ctrl+-', () => {
        updateZoomBy(-0.1);
      });

      Mousetrap.bind('ctrl+0', () => {
        setZoom(1.0);
      });
    }

    unlistenFns.push(
      backend.listen('menu-new-note', () => emitter.emit('new-note')),
      backend.listen('menu-zoom-in', () => updateZoomBy(0.1)),
      backend.listen('menu-zoom-out', () => updateZoomBy(-0.1)),
      backend.listen('print-pdf-request', (event, payload) => {
        const pdfName = payload?.pdfName || payload?.pdf_name || 'Beaver Notes';
        const previousTitle = document.title;
        let overlayStyle = document.getElementById('beaver-overlay-print');

        if (!overlayStyle) {
          overlayStyle = document.createElement('style');
          overlayStyle.id = 'beaver-overlay-print';
          overlayStyle.textContent =
            '.overlay-canvas-root { position: absolute !important; pointer-events: none !important; opacity: 1 !important; }';
          document.head.appendChild(overlayStyle);
        }

        const restoreTitle = () => {
          document.title = previousTitle;
          document.getElementById('beaver-overlay-print')?.remove();
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

    try {
      await appReady();
      await initializeSafeAreaInsets();
    } catch (error) {
      console.error(
        'Error notifying the Tauri backend that the app is ready:',
        error
      );
    }

    initializeMobileKeyboardTracking(unlistenFns);

    try {
      const autoUpdateEnabled = await getAutoUpdateStatus();

      if (autoUpdateEnabled) {
        setTimeout(async () => {
          try {
            await checkForUpdates();
          } catch (error) {
            console.warn('Auto-update check failed:', error);
          }
        }, 1000);
      }
    } catch (error) {
      console.error('Error checking auto-update status:', error);
    }

    try {
      await initializeWorkspace();
    } catch (error) {
      console.error('Error initializing workspace:', error);
      retrieved.value = true;
    }

    void refreshSyncLockBanner();
    removeBeforeRouteGuard = router.beforeEach((to, from, next) => {
      animateRouteChange.value =
        Boolean(from.name) && to.fullPath !== from.fullPath;
      next();
    });
    removeRouteGuard = router.afterEach(() => {
      void refreshSyncLockBanner();
    });
  });

  onUnmounted(() => {
    if (removeBeforeRouteGuard) removeBeforeRouteGuard();
    if (removeRouteGuard) removeRouteGuard();
    unlistenFns.forEach((subscription) => {
      Promise.resolve(subscription)
        .then((unlisten) => unlisten?.())
        .catch(() => {});
    });
  });

  theme.loadTheme();

  onFileOpened(async (path) => {
    await router.isReady();
    while (!retrieved.value)
      await new Promise((resolve) => setTimeout(resolve, 100));
    await importBEA(path, router, store);
  });

  setZoomLevel(getStoredZoomLevel());
  setMenuVisibility(!getSettingSync('visibilityMenubar'));

  return {
    animateRouteChange,
    appStore,
    bottomBannerStyle,
    dismissSyncBanner,
    getTopLevelRouteKey,
    handleUpdateDismiss,
    handleUpdateInstall: () => handleUpdateInstall(installUpdate),
    mainStyle,
    mobileNavbarStyle,
    openSyncSettings,
    retrieved,
    showMobileNavbar,
    showSidebar,
    state,
    store,
    syncLockBanner,
    syncLockBannerCopy,
    updateBanner,
  };
}
