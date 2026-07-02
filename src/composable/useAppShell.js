import { nextTick, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const AUTO_UPDATE_CHECK_DELAY_MS = 1000;
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
import { getSyncPath } from '@/utils/sync/path';
import { backend, onFileOpened } from '@/lib/tauri-bridge';
import { appReady, setMenuVisibility, setZoomLevel } from '@/lib/native/app';
import {
  checkForUpdates,
  getAutoUpdateStatus,
  installUpdate,
  isUpdateManaged,
} from '@/lib/native/updates';
import { getStoredZoomLevel, setStoredZoomLevel } from './zoom';
import { tryRestoreKeyFromSafeStorage } from '@/utils/crypto/encryption.js';
import { useSoundActions } from './useSoundActions';

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

  useSoundActions();

  const retrieved = ref(false);
  const animateRouteChange = ref(true);
  const showImportDialog = ref(false);
  const importFilePath = ref('');
  const importNoteTitle = ref('');
  const importFileType = ref(''); // 'bea' | 'md' | 'mdx' | 'txt' | 'html'
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
    appEncryptionMigrationBanner,
    dismissAppEncryptionMigrationBanner,
    openAppEncryptionMigrationSettings,
    checkAppEncryptionMigration,
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
    await tryRestoreKeyFromSafeStorage();
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

    const migrationStatus = await settingsStorage.get(
      'app_encryption_migration',
      null
    );
    if (migrationStatus) {
      checkAppEncryptionMigration(migrationStatus);
    }

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
      const managed = await isUpdateManaged();

      if (!managed) {
        const autoUpdateEnabled = await getAutoUpdateStatus();

        if (autoUpdateEnabled) {
          setTimeout(async () => {
            try {
              await checkForUpdates();
            } catch (error) {
              console.warn('Auto-update check failed:', error);
            }
          }, AUTO_UPDATE_CHECK_DELAY_MS);
        }
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
    removeRouteGuard = router.afterEach(async () => {
      void refreshSyncLockBanner();
      await nextTick();
      const mainEl = document.querySelector('[data-testid="app-main"]');
      if (mainEl) mainEl.scrollTop = 0;
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

    const ext = path.split('.').pop().toLowerCase();

    const SUPPORTED = ['bea', 'md', 'mdx', 'txt', 'html'];
    if (!SUPPORTED.includes(ext)) {
      console.warn('Unsupported file format for import:', ext, path);
      return;
    }

    importFileType.value = ext;

    try {
      let title;

      if (ext === 'bea') {
        // Read just the metadata from the BEA JSON
        const fileContent = await import('@/lib/native/exports').then((m) =>
          m.readImportJson(path)
        );
        title =
          fileContent?.data?.title ||
          path
            .split('/')
            .pop()
            .replace(/\.bea$/i, '') ||
          'Untitled';
      } else {
        // Use lightweight title extraction for text-based formats
        const { extractImportTitle } = await import(
          '@/utils/import/fileImport'
        );
        title = await extractImportTitle(path);
      }

      importNoteTitle.value = title;
      importFilePath.value = path;
      showImportDialog.value = true;
    } catch (error) {
      console.error('Failed to read file metadata:', error);
    }
  });

  async function handleImportConfirm(folderId) {
    if (!importFilePath.value) return;
    const path_ = importFilePath.value;
    const type = importFileType.value;
    try {
      if (type === 'bea') {
        await importBEA(path_, router, store, folderId);
      } else {
        const { importSingleFile } = await import('@/utils/import/fileImport');
        const noteId = await importSingleFile(path_, folderId);
        router.push(`/note/${noteId}`);
      }
    } catch (error) {
      console.error(`Failed to import ${type} file:`, error);
    } finally {
      importFilePath.value = '';
      importNoteTitle.value = '';
      importFileType.value = '';
      showImportDialog.value = false;
    }
  }

  function handleImportCancel() {
    importFilePath.value = '';
    importNoteTitle.value = '';
    importFileType.value = '';
    showImportDialog.value = false;
  }

  setZoomLevel(getStoredZoomLevel());
  setMenuVisibility(!getSettingSync('visibilityMenubar'));

  return {
    animateRouteChange,
    appStore,
    handleImportCancel,
    handleImportConfirm,
    importFilePath,
    importNoteTitle,
    importFileType,
    showImportDialog,
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
    appEncryptionMigrationBanner,
    dismissAppEncryptionMigrationBanner,
    openAppEncryptionMigrationSettings,
  };
}
