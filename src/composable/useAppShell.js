import {
  nextTick,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  computed,
  watch,
} from 'vue';
import { useRoute, useRouter } from 'vue-router';

const AUTO_UPDATE_CHECK_DELAY_MS = 1000;
import { useTheme } from './theme';
import { useStorage } from './storage';
import { getSettingSync, hydrateSettingsStore, setSetting } from './settings';
import { useUiState } from '@/composable/useUiState';
import { useTranslations } from '@/composable/useTranslations';
import Mousetrap from '@/lib/mousetrap';
import emitter from 'tiny-emitter/instance';
import { useAppStore } from '@/store/app';
import { useStore } from '@/store';

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
import { getStoredZoomLevel, setStoredZoomLevel, wasZoomAppliedAtBoot } from './zoom';
import {
  tryRestoreKeyFromSafeStorage,
  encryptionIsConfigured,
  isKeyLoaded,
} from '@/utils/crypto/encryption.js';
import { useSoundActions } from './useSoundActions';
import {
  loadWorkspaceDoc,
  observeWorkspace,
  writeStoresFromWorkspace,
  backfillNotePreviews,
} from './useWorkspaceYjs';
import { getSyncEngine } from '@/utils/sync/engine.js';
import { initAppSync } from '@/utils/sync/app-sync.js';

const ONBOARDING_ROUTE_NAME = 'Onboarding';
const SETTINGS_ROUTE_PREFIX = '/settings';

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

export function useAppShell(onboardingCompleted = true) {
  const { translations } = useTranslations();
  const theme = useTheme();
  const store = useStore();
  const route = useRoute();
  const router = useRouter();
  const settingsStorage = useStorage('settings');
  const dataStorage = useStorage('data');
  const appStore = useAppStore();

  useSoundActions();

  const uiState = useUiState();
  const retrieved = ref(false);
  const animateRouteChange = ref(true);
  const showImportDialog = ref(false);
  const importFilePath = ref('');
  const importNoteTitle = ref('');
  const importFileType = ref(''); // 'bea' | 'md' | 'mdx' | 'txt' | 'html'
  const importFileContent = ref('');
  const state = reactive({
    zoomLevel: getStoredZoomLevel().toFixed(1),
  });
  // ── Layout ──
  const keyboardVisible = ref(false);
  const pluginKeyboardVisible = ref(false);
  const isMobileRuntime = computed(() => backend.isMobileRuntime());
  const isPhoneRuntime = computed(() => backend.isPhoneRuntime());
  const showSidebar = computed(
    () => !uiState.inReaderMode && route.name !== ONBOARDING_ROUTE_NAME
  );
  const showMobileNavbar = computed(
    () =>
      showSidebar.value &&
      route.name !== 'Note' &&
      (!isPhoneRuntime.value || !keyboardVisible.value)
  );
  const useMobileBottomDockSpacing = computed(
    () => isPhoneRuntime.value && showMobileNavbar.value
  );
  const mainStyle = computed(() => {
    if (!isMobileRuntime.value || route.name === ONBOARDING_ROUTE_NAME)
      return undefined;
    return {
      paddingTop: 'var(--app-safe-area-top)',
      paddingBottom: useMobileBottomDockSpacing.value
        ? 'var(--app-mobile-content-offset)'
        : 'var(--app-safe-area-bottom)',
    };
  });
  const bottomBannerStyle = computed(() => {
    if (!isMobileRuntime.value) return undefined;
    return {
      bottom: useMobileBottomDockSpacing.value
        ? 'var(--app-mobile-floating-offset)'
        : 'var(--app-safe-area-bottom)',
    };
  });
  const mobileNavbarStyle = computed(() => {
    if (!isMobileRuntime.value || !showMobileNavbar.value) return undefined;
    return {
      bottom: 'var(--app-safe-area-bottom)',
    };
  });
  const showSafeAreaOverlay = computed(() => {
    if (!isMobileRuntime.value) return false;
    if (route.name === ONBOARDING_ROUTE_NAME) return false;
    if (uiState.overlayCount > 0) return false;
    return true;
  });

  let maxVisualViewportHeight = 0;
  let pendingBlurTimeout = null;
  let removeMobileKeyboardListeners = () => {};

  const isEditableElement = (element) => {
    if (!element || typeof element !== 'object') return false;
    const tagName = element.tagName?.toLowerCase?.() || '';
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
      return true;
    }
    return Boolean(element.isContentEditable);
  };

  const syncKeyboardVisibility = () => {
    if (
      typeof window === 'undefined' ||
      !isMobileRuntime.value ||
      !window.visualViewport
    ) {
      return;
    }
    const viewportHeight = window.visualViewport.height;
    if (viewportHeight > maxVisualViewportHeight) {
      maxVisualViewportHeight = viewportHeight;
    }
    const activeElement = document.activeElement;
    const hasEditableFocus = isEditableElement(activeElement);
    const keyboardDelta = maxVisualViewportHeight - viewportHeight;
    keyboardVisible.value =
      hasEditableFocus && (keyboardDelta > 120 || pluginKeyboardVisible.value);
  };

  watch(
    showMobileNavbar,
    (visible) => {
      if (typeof document === 'undefined' || !isPhoneRuntime.value) return;
      document.documentElement.style.setProperty(
        '--app-mobile-dock-height-active',
        visible ? 'var(--app-mobile-dock-height)' : '0px'
      );
    },
    { immediate: true }
  );

  watch(
    keyboardVisible,
    (visible) => {
      if (typeof document === 'undefined' || !isMobileRuntime.value) return;
      document.documentElement.style.setProperty(
        '--app-keyboard-inset-bottom',
        visible ? '8px' : 'var(--app-safe-area-bottom)'
      );
    },
    { immediate: true }
  );

  const initializeSafeAreaInsets = async () => {
    if (!isMobileRuntime.value) return;
    try {
      const { getTopInset, getBottomInset } = await import(
        '@saurl/tauri-plugin-safe-area-insets-css-api'
      );
      const topInset = await getTopInset();
      const bottomInset = await getBottomInset();
      const bottomInsetValue = `${bottomInset?.inset ?? 0}px`;
      const rootStyle = document.documentElement.style;
      rootStyle.setProperty(
        '--safe-area-inset-top',
        `${topInset?.inset ?? 0}px`
      );
      rootStyle.setProperty('--safe-area-inset-bottom', bottomInsetValue);
      rootStyle.setProperty('--app-keyboard-inset-bottom', bottomInsetValue);
      rootStyle.setProperty('--app-toolbar-bottom', bottomInsetValue);
      rootStyle.setProperty(
        '--app-note-page-padding',
        `calc(54px + ${bottomInsetValue} + 0.75rem)`
      );
    } catch (error) {
      console.warn('Safe area inset CSS plugin failed to initialize:', error);
    }
  };

  const initializeMobileKeyboardTracking = (unlistenFns) => {
    if (!isMobileRuntime.value) return;
    unlistenFns.push(
      backend.listen('keyboard_shown', () => {
        pluginKeyboardVisible.value = true;
        keyboardVisible.value = true;
      }),
      backend.listen('keyboard_hidden', () => {
        pluginKeyboardVisible.value = false;
        keyboardVisible.value = false;
      })
    );
    maxVisualViewportHeight =
      window.visualViewport?.height ?? window.innerHeight ?? 0;
    const handleFocusIn = () => {
      if (pendingBlurTimeout) {
        clearTimeout(pendingBlurTimeout);
        pendingBlurTimeout = null;
      }
      requestAnimationFrame(syncKeyboardVisibility);
    };
    const handleFocusOut = () => {
      pendingBlurTimeout = window.setTimeout(() => {
        syncKeyboardVisibility();
        pendingBlurTimeout = null;
      }, 180);
    };
    const handleViewportChange = () => {
      requestAnimationFrame(syncKeyboardVisibility);
    };
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    window.visualViewport?.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('scroll', handleViewportChange);
    removeMobileKeyboardListeners = () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
      window.visualViewport?.removeEventListener(
        'resize',
        handleViewportChange
      );
      window.visualViewport?.removeEventListener(
        'scroll',
        handleViewportChange
      );
      if (pendingBlurTimeout) {
        clearTimeout(pendingBlurTimeout);
        pendingBlurTimeout = null;
      }
    };
    syncKeyboardVisibility();
  };

  onUnmounted(() => {
    removeMobileKeyboardListeners();
  });

  // ── Banners ──
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
  const appEncryptionMigrationBanner = reactive({
    show: false,
    dismissed: false,
    status: null,
    error: null,
  });
  // Full-screen gate shown on launch when encryption is configured but the key
  // is not loaded (and could not be auto-restored). Forces unlock before use.
  const appEncryptionGate = reactive({
    show: false,
    deriving: false,
  });

  const syncLockBannerCopy = computed(() => ({
    content:
      translations.value.app?.syncLockContent ||
      'Sync is encrypted but locked on this device. Unlock it in Settings to resume sync.',
    primaryText: translations.value.app?.openSettings || 'Open Settings',
    secondaryText: translations.value.app?.dismiss || 'Dismiss',
  }));

  const appEncryptionMigrationBannerCopy = computed(() => ({
    content:
      appEncryptionMigrationBanner.status === 'in_progress'
        ? translations.value.app?.encryptionMigrationInProgress ||
          'App encryption migration is in progress. Please wait for it to complete.'
        : translations.value.app?.encryptionMigrationFailed ||
          'App encryption migration did not complete. Please re-enable app encryption from Settings.',
    primaryText: translations.value.app?.openSettings || 'Open Settings',
    secondaryText: translations.value.app?.dismiss || 'Dismiss',
  }));

  const handleUpdateInstall = (installUpdate) => {
    installUpdate();
    updateBanner.show = false;
  };

  const handleUpdateDismiss = () => {
    updateBanner.show = false;
  };

  const openSyncSettings = () => {
    syncLockBanner.show = false;
    router.push(SETTINGS_ROUTE_PREFIX);
  };

  const dismissSyncBanner = () => {
    syncLockBanner.dismissed = true;
    syncLockBanner.show = false;
  };

  const refreshSyncLockBanner = async () => {
    const inSettings = router.currentRoute.value.path.startsWith(
      SETTINGS_ROUTE_PREFIX
    );
    if (
      inSettings ||
      syncLockBanner.dismissed ||
      route.name === ONBOARDING_ROUTE_NAME
    ) {
      syncLockBanner.show = false;
      return;
    }
    const configured = await encryptionIsConfigured();
    syncLockBanner.show = configured && !isKeyLoaded();
    await refreshEncryptionGate(configured);
  };

  const dismissAppEncryptionMigrationBanner = () => {
    appEncryptionMigrationBanner.dismissed = true;
    appEncryptionMigrationBanner.show = false;
  };

  const openAppEncryptionMigrationSettings = () => {
    appEncryptionMigrationBanner.show = false;
    router.push(SETTINGS_ROUTE_PREFIX);
  };

  const checkAppEncryptionMigration = (migrationStatus) => {
    if (!migrationStatus) return;
    const { status, error } = migrationStatus;
    if (status === 'in_progress' || status === 'error') {
      appEncryptionMigrationBanner.status = status;
      appEncryptionMigrationBanner.error = error || null;
      if (!appEncryptionMigrationBanner.dismissed) {
        appEncryptionMigrationBanner.show = true;
      }
    }
  };

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
    appEncryptionGate.deriving = true;
    try {
      await tryRestoreKeyFromSafeStorage();
    } finally {
      appEncryptionGate.deriving = false;
    }
    await refreshEncryptionGate();
  };

  const refreshEncryptionGate = async (configuredOverride) => {
    if (route.name === ONBOARDING_ROUTE_NAME) {
      appEncryptionGate.show = false;
      return;
    }
    const configured =
      configuredOverride !== undefined
        ? configuredOverride
        : await encryptionIsConfigured();
    appEncryptionGate.show = configured && !isKeyLoaded();
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
    performance.mark('init:start');

    // Set retrieved immediately — the UI can render while we check onboarding state.
    // This eliminates the white screen for both first-time and returning users.
    retrieved.value = true;

    await hydrateSettingsStore();
    setSetting('spellcheckEnabled', getSettingSync('spellcheckEnabled'));
    performance.mark('init:settings');

    const [hasData, onboardingCompleted] = await Promise.all([
      hasExistingWorkspaceData(),
      settingsStorage.get('onboardingCompleted', false),
    ]);

    if (!hasData && !onboardingCompleted) {
      // First run: initialize the sync engine before entering onboarding so a
      // post-onboarding sync (path set + initial pull) has a live engine. With
      // no sync folder configured yet the engine's cycles are no-ops.
      initAppSync();
      if (route.name !== ONBOARDING_ROUTE_NAME) {
        await router.replace('/onboarding');
      }
      return;
    }

    // Derive/restore the encryption key BEFORE reading any note data. Note
    // blobs are encrypted at rest when the vault is enabled, so loading them
    // before the items key is available would hand ciphertext to the Yjs
    // decoder (which aborts on invalid UTF-8).
    await restoreEncryptionKeys();
    performance.mark('init:encryption');

    if ((await encryptionIsConfigured()) && !isKeyLoaded()) {
      // Encryption is configured but the key could not be restored (no stored
      // passphrase / safe storage unavailable). Loading note data now would
      // yield garbage (or fail closed server-side), so defer until the user
      // unlocks via the encryption gate. handleEncryptionUnlocked() runs the
      // remainder of the init afterwards.
      retrieved.value = true;
      return;
    }

    await finishWorkspaceInit();
  };

  const finishWorkspaceInit = async () => {
    const migrationStatus = await settingsStorage.get(
      'app_encryption_migration',
      null
    );
    if (migrationStatus) {
      checkAppEncryptionMigration(migrationStatus);
    }

    // Load the unified workspace Y.Doc first — it is the single source of
    // truth for all note/folder/label metadata.  On first run after legacy
    // migration the doc may still be empty, so seed it from the KV stores
    // before wiring observers.
    await loadWorkspaceDoc();
    performance.mark('init:workspace-doc');
    observeWorkspace(writeStoresFromWorkspace);
    await writeStoresFromWorkspace();
    performance.mark('init:workspace-write');

    // Post-process — the stores are now populated from Yjs, so retrieve()
    // must NOT read from KV.
    await store.retrieve();
    performance.mark('init:retrieve');
    await refreshSyncLockBanner();

    // One-time deferred backfill of card previews for notes that predate the
    // persisted `cardPreview` (so their cards aren't blank on launch).
    if (!(await settingsStorage.get('preview_backfill_done', false))) {
      backfillNotePreviews()
        .then(() => settingsStorage.set('preview_backfill_done', true))
        .catch((err) => console.warn('[app] preview backfill failed:', err));
    }

    if (appStore.setting.openLastEdited) {
      const lastNoteEdit = localStorage.getItem('lastNoteEdit');
      if (lastNoteEdit && route.name !== ONBOARDING_ROUTE_NAME) {
        router.push(`/note/${lastNoteEdit}`);
      }
    }

    // Always initialize the engine so runtime sync config (Settings "Sync now",
    // transport, path pick) works without an app restart. Autosync is always
    // on — periodic sync runs whenever the app is visible.
    try {
      const { useAccountStore } = await import('@/store/account');
      const { useWorkspaceStore } = await import('@/store/workspace.ts');
      const accountStore = useAccountStore();
      // Ensure auth is hydrated before sync — hydrate() runs in onMounted of
      // useAccountAuth components which may not have mounted yet.
      if (!accountStore.isAuthenticated) {
        const { loadSessionToken } = await import('@/composable/useAccountStorage');
        const token = await loadSessionToken().catch(() => null);
        if (token) {
          accountStore.setStatus('authenticated');
        }
      }
      if (accountStore.isAuthenticated) {
        // Fetch profile/subscription so _remoteAllowed has plan info for sync
        import('@/lib/api/account').then(({ getAccount }) => {
          getAccount({ baseUrl: accountStore.serverUrl }).then((data) => {
            if (data) {
              accountStore.setProfile(data.profile);
              accountStore.setSubscription(data.subscription);
              accountStore.setDevices(data.devices || []);
            }
          }).catch(() => {});
        }).catch(() => {});
        await useWorkspaceStore().retrieve();
      }
    } catch (err) {
      console.warn('[app] pre-sync auth/workspace hydrate failed:', err);
    }
    initAppSync();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    performance.mark('init:done');
    const entries = performance.getEntriesByType('mark');
    const measures = [];
    for (let i = 1; i < entries.length; i++) {
      measures.push(`${entries[i].name}: ${Math.round(entries[i].startTime - entries[i-1].startTime)}ms`);
    }
    console.log('[perf] Startup timeline:', measures.join(' → '));
    console.log('[perf] Total startup:', Math.round(entries[entries.length-1].startTime - entries[0].startTime) + 'ms');
  };

  // Runs when the user unlocks the app via the encryption gate. The gate is
  // only reachable when a configured vault could not be auto-unlocked, so this
  // is the deferred remainder of initializeWorkspace().
  const handleEncryptionUnlocked = () => {
    appEncryptionGate.show = false;
    finishWorkspaceInit().catch((err) => {
      console.error('[app] workspace init after unlock failed:', err);
      retrieved.value = true;
    });
  };

  const handleDeepLink = async (payload) => {
    try {
      const raw = typeof payload === 'string' ? payload : payload?.url || payload?.path || '';
      const path = raw.replace(/^beaver-notes:\/\//, '');
      if (path.startsWith('join/')) {
        const token = path.slice('join/'.length);
        if (!token) return;
        const { useAccountStore } = await import('@/store/account');
        const accountStore = useAccountStore();
        if (!accountStore.isAuthenticated) {
          console.warn('[deep-link] Cannot join note: not authenticated');
          return;
        }
        const { joinViaInviteLink } = await import('@/lib/api/collaboration');
        const result = await joinViaInviteLink(token, { baseUrl: accountStore.serverUrl });
        if (result?.noteId) {
          router.push(`/note/${result.noteId}`);
        }
      }
    } catch (err) {
      console.error('[deep-link] Failed to handle deep link:', err);
    }
  };

  onMounted(async () => {
    document.body.style.zoom = state.zoomLevel;

    // Skip heavy init for first-time users (onboarding not completed)
    if (!onboardingCompleted) {
      retrieved.value = true;
      return;
    }

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
      backend.listen('spellcheck-changed', () => {}),
      backend.listen('deep-link://received', (_, payload) => {
        handleDeepLink(payload);
      })
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
      try {
        const [hasData, onboardingCompleted] = await Promise.all([
          dataStorage.get('notes', {}),
          settingsStorage.get('onboardingCompleted', false),
        ]);
        if (!hasData && !onboardingCompleted) {
          retrieved.value = true;
          await router.replace('/onboarding');
          return;
        }
      } catch (innerError) {
        console.error('Fallback onboarding check failed:', innerError);
      }
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

  function handleVisibilityChange() {
    if (document.hidden) {
      // Flush cloud push before going to background
      const engine = getSyncEngine();
      if (engine) engine.flush().catch(() => {});
      engine?.stopPullTimer();
    } else {
      // App returned to foreground — pull remote changes and restart pull timer
      const engine = getSyncEngine();
      if (engine) engine.notifyForeground().catch(() => {});
      engine?.startPullTimer();
    }
  }

  onUnmounted(() => {
    if (removeBeforeRouteGuard) removeBeforeRouteGuard();
    if (removeRouteGuard) removeRouteGuard();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    getSyncEngine()?.stopPullTimer();
    unlistenFns.forEach((subscription) => {
      Promise.resolve(subscription)
        .then((unlisten) => unlisten?.())
        .catch(() => {});
    });
  });

  theme.loadTheme();

  onFileOpened(async (path) => {
    await router.isReady();
    if (!retrieved.value) {
      await new Promise((resolve) => {
        const unwatch = watch(
          retrieved,
          (val) => {
            if (val) {
              unwatch();
              resolve();
            }
          },
          { immediate: true }
        );
      });
    }

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
        // Read file once, reuse for title extraction and later import
        const { readFile } = await import('@/lib/native/fs');
        const { extractImportTitle } = await import(
          '@/utils/import/fileImport'
        );
        const raw = await readFile(path);
        importFileContent.value = raw;
        title = await extractImportTitle(path, raw);
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
    const rawContent = importFileContent.value || undefined;
    try {
      if (type === 'bea') {
        await importBEA(path_, router, store, folderId);
      } else {
        const { importSingleFile } = await import('@/utils/import/fileImport');
        const noteId = await importSingleFile(path_, folderId, rawContent);
        router.push(`/note/${noteId}`);
      }
    } catch (error) {
      console.error(`Failed to import ${type} file:`, error);
    } finally {
      importFilePath.value = '';
      importNoteTitle.value = '';
      importFileType.value = '';
      importFileContent.value = '';
      showImportDialog.value = false;
    }
  }

  function handleImportCancel() {
    importFilePath.value = '';
    importNoteTitle.value = '';
    importFileType.value = '';
    importFileContent.value = '';
    showImportDialog.value = false;
  }

  if (!wasZoomAppliedAtBoot()) {
    setZoomLevel(getStoredZoomLevel());
  }
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
    appEncryptionGate,
    refreshEncryptionGate,
    handleEncryptionUnlocked,
    updateBanner,
    appEncryptionMigrationBanner,
    appEncryptionMigrationBannerCopy,
    dismissAppEncryptionMigrationBanner,
    openAppEncryptionMigrationSettings,
    showSafeAreaOverlay,
    uiState,
  };
}
