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
import { useStorage } from '@/lib/storage';
import { getSettingSync, hydrateSettingsStore, setSetting } from '@/lib/settings';
import { useUiState } from '@/composable/useUiState';
import { useTranslations } from '@/composable/useTranslations';
import Mousetrap from '@/lib/mousetrap';
import emitter from 'tiny-emitter/instance';
import { useAppStore } from '@/store/app';
import { useAccountStore } from '@/store/account';
import { useStore } from '@/store';

import { importBEA } from '@/utils/share/BEA';
import { backend, onFileOpened } from '@/lib/tauri-bridge';
import { appReady, notify, setMenuVisibility, setZoomLevel } from '@/lib/native/app';
import {
  checkForUpdates,
  getAutoUpdateStatus,
  installUpdate,
  isUpdateManaged,
} from '@/lib/native/updates';
import { getStoredZoomLevel, setStoredZoomLevel, wasZoomAppliedAtBoot } from '@/utils/ui/zoom';
import {
  encryptionIsConfigured,
  isKeyLoaded,
} from '@/utils/crypto/encryption.js';
import { useSoundActions } from './useSoundActions';
import { useAppEncryptionGate } from './useAppEncryptionGate';
import {
  loadWorkspaceDoc,
  observeWorkspace,
  writeStoresFromWorkspace,
  backfillNotePreviews,
} from '@/lib/yjs/workspace-doc';
import { getSyncEngine } from '@/utils/sync/engine.js';
import { initAppSync } from '@/utils/sync/app-sync.js';

import { buildMenuContext, pushMenuContext } from '@/utils/ui/menuContext';
import { useSidebar } from '@/composable/useSidebar';

// Re-exported here so it stays unit-testable via this module
// (see src/composable/__tests__/menu-context.spec.js).
export { buildMenuContext };

const ONBOARDING_ROUTE_NAME = 'Onboarding';
const SETTINGS_ROUTE_PREFIX = '/settings';

// Dev-only startup instrumentation. esbuild strips console.log in prod builds.
function logStartupTiming() {
  const entries = performance.getEntriesByType('mark');
  const measures = [];
  for (let i = 1; i < entries.length; i++) {
    measures.push(
      `${entries[i].name}: ${Math.round(
        entries[i].startTime - entries[i - 1].startTime
      )}ms`
    );
  }
  // eslint-disable-next-line no-console -- dev-only startup instrumentation (esbuild strips console.log in prod)
  console.log('[perf] Startup timeline:', measures.join(' → '));
  // eslint-disable-next-line no-console -- dev-only startup instrumentation (esbuild strips console.log in prod)
  console.log(
    '[perf] Total startup:',
    Math.round(entries[entries.length - 1].startTime - entries[0].startTime) +
      'ms'
  );
}

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
  const keyboardVisible = ref(false);
  const pluginKeyboardVisible = ref(false);
  const isMobileRuntime = computed(() => backend.isMobileRuntime());
  const isPhoneRuntime = computed(() => backend.isPhoneRuntime());
  const showSidebar = computed(
    () => !uiState.inReaderMode && route.name !== ONBOARDING_ROUTE_NAME
  );
  const showMobileNavbar = computed(
    () =>
      route.name !== ONBOARDING_ROUTE_NAME &&
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
  const { expanded: sidebarExpanded } = useSidebar();
  const undoBannerWrapperStyle = computed(() => {
    if (isMobileRuntime.value) {
      return {
        ...bottomBannerStyle.value,
        left: '0',
        right: '0',
      };
    }
    if (!showSidebar.value) return undefined;
    return {
      left: sidebarExpanded.value ? '16rem' : '4rem',
      right: '0',
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

  // Keep the native menu in sync with the current screen. Desktop only;
  // debounced so rapid navigation coalesces into one rebuild.
  watch(
    () => [route.name, uiState.inReaderMode],
    () => {
      if (!backend.isDesktopRuntime()) return;
      pushMenuContext(
        buildMenuContext({
          routeName: route.name,
          inReaderMode: uiState.inReaderMode,
        })
      );
    },
    { immediate: true }
  );

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
      document.documentElement.style.setProperty(
        '--app-note-page-padding',
        `calc(56px + var(--app-keyboard-inset-bottom) + 0.75rem)`
      );
    },
    { immediate: true }
  );

  // ponytail: 1.5s ceiling, real safe-area plugin can hang on cold iOS launch, never block first paint
  const withTimeout = (p, ms, label) =>
    Promise.race([
      p,
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error(`${label} timeout after ${ms}ms`)), ms)
      ),
    ]);

  const initializeSafeAreaInsets = async () => {
    if (!isMobileRuntime.value) return;
    try {
      const { getTopInset, getBottomInset } = await withTimeout(
        import('@saurl/tauri-plugin-safe-area-insets-css-api'),
        1500,
        'safe-area import'
      );
      const [topInset, bottomInset] = await withTimeout(
        Promise.all([getTopInset(), getBottomInset()]),
        1500,
        'safe-area insets'
      );
      const bottomInsetValue = `${bottomInset?.inset ?? 0}px`;
      const rootStyle = document.documentElement.style;
      rootStyle.setProperty(
        '--safe-area-inset-top',
        `${topInset?.inset ?? 0}px`
      );
      rootStyle.setProperty('--safe-area-inset-bottom', bottomInsetValue);
      rootStyle.setProperty('--app-keyboard-inset-bottom', bottomInsetValue);
      rootStyle.setProperty('--app-toolbar-bottom', bottomInsetValue);
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

  const updateBanner = reactive({
    show: false,
    content: '',
    primaryText: '',
    secondaryText: '',
    version: '',
  });
  const appEncryptionMigrationBanner = reactive({
    show: false,
    dismissed: false,
    status: null,
    error: null,
  });

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

  const hasExistingWorkspaceData = async () => {
    const isLocked = (e) => {
      const msg = String(e?.message || e || '');
      return msg.includes('EncryptionLocked') || msg.includes('App encryption is locked');
    };
    // Yjs workspace doc is the source for notes/folders (KV `notes`/`folders`
    // are legacy, never written post-migration); KV is only a fallback for
    // not-yet-migrated users.
    try {
      const snap = await withTimeout(
        backend.invoke('yjs:getSnapshot', { noteId: 'meta' }),
        2000,
        'yjs:getSnapshot'
      );
      if (snap?.data?.length) return true;
    } catch (e) {
      if (isLocked(e)) return true;
    }
    try {
      const { useStorage: _useStorage } = await import('@/lib/storage');
      const legacy = _useStorage('data');
      const [notesData, foldersData] = await withTimeout(
        Promise.all([
          legacy.get('notes', {}),
          legacy.get('folders', {}),
        ]),
        2000,
        'legacy storage'
      );
      return (
        Object.keys(notesData || {}).length > 0 ||
        Object.keys(foldersData || {}).length > 0
      );
    } catch (e) {
      if (isLocked(e)) return true;
      return false;
    }
  };

  const initializeWorkspace = async () => {
    performance.mark('init:start');

    // Set immediately: UI renders while onboarding checked (no white screen).
    retrieved.value = true;

    await hydrateSettingsStore();
    setSetting('spellcheckEnabled', getSettingSync('spellcheckEnabled'));
    performance.mark('init:settings');

    const [hasData, onboardingCompleted] = await Promise.all([
      hasExistingWorkspaceData(),
      settingsStorage.get('onboardingCompleted', false),
    ]);

    if (!hasData && !onboardingCompleted) {
      // Init the sync engine before onboarding so post-onboarding sync has a
      // live engine; with no sync folder configured the cycles are no-ops.
      initAppSync();
      performance.mark('init:done');
      logStartupTiming();
      if (route.name !== ONBOARDING_ROUTE_NAME) {
        await router.replace('/onboarding');
      }
      return;
    }

    // Derive/restore the encryption key BEFORE reading note data: blobs are
    // encrypted at rest, and handing ciphertext to the Yjs decoder makes it
    // abort on invalid UTF-8.
    await restoreEncryptionKeys();
    performance.mark('init:encryption');

    // The vault passphrase is user-set during onboarding; startup never
    // auto-creates encryption. The yjs layer fails closed if it is missing.
    if ((await encryptionIsConfigured()) && !isKeyLoaded()) {
      // Key configured but unrestorable: defer to gate, remainder runs on unlock.
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

    // Load unified workspace Y.Doc: single truth for note/folder/label metadata, seeded during onboarding.
    await loadWorkspaceDoc();
    performance.mark('init:workspace-doc');
    observeWorkspace(writeStoresFromWorkspace);
    await writeStoresFromWorkspace();
    performance.mark('init:workspace-write');

    // Stores now from Yjs: retrieve() must NOT read KV.
    await store.retrieve();
    performance.mark('init:retrieve');

    // One-time idempotent re-encryption of legacy migration rows (plaintext
    // titles/folder metadata on disk).
    backend.invoke('storage:reencryptLegacyRows').catch((err) => {
      console.warn('[app] legacy row re-encryption failed:', err?.message || err);
    });
    // One-time repair: rows sealed while settings were incorrectly encrypted
    // become plaintext after the fix; decrypt with the now-loaded key.
    backend.invoke('storage:repairSettings').catch((err) => {
      console.warn('[app] settings repair failed:', err?.message || err);
    });

    // One-time backfill of previews for notes predating persisted `cardPreview`.
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

    // Always init so runtime sync works without restart. Autosync on: periodic sync when visible.
    try {
      const { useWorkspaceStore } = await import('@/store/workspace.ts');
      const accountStore = useAccountStore();
      // Hydrate auth before sync: hydrate() runs in onMounted, may not have mounted yet.
      if (!useAccountStore().isAuthenticated) {
        const { loadSessionToken } = await import('@/lib/account-storage');
        const token = await loadSessionToken().catch(() => null);
        if (token) {
          accountStore.setToken(token);
          accountStore.setStatus('authenticated');
        }
      }
      if (useAccountStore().isAuthenticated) {
        // Fetch profile/subscription so _remoteAllowed has plan info; awaited
        // so initAppSync() runs with full auth state.
        try {
          const { getAccount } = await import('@/lib/api/account');
          const data = await getAccount({ baseUrl: accountStore.serverUrl });
          if (data) {
            accountStore.setProfile(data.profile);
            accountStore.setSubscription(data.subscription);
            accountStore.setDevices(data.devices || []);
          }
        } catch {
          // non-critical: sync retries next cycle.
        }
        await useWorkspaceStore().retrieve();

        // Join meta room now activeId known (was null at loadWorkspaceDoc).
        const { getWsSync } = await import('@/lib/sync/ws-sync');
        const { ensureMetaRoomKey } = await import('@/lib/yjs/workspace-doc');
        const wsId = useWorkspaceStore().activeId;
        if (wsId) {
          await ensureMetaRoomKey(wsId).catch(() => {});
          getWsSync().joinMetaRoom(wsId);
        }
      }
    } catch (err) {
      console.warn('[app] pre-sync auth/workspace hydrate failed:', err);
    }
    initAppSync();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    performance.mark('init:done');
    logStartupTiming();
  };

  const encryptionGate = useAppEncryptionGate({
    finishWorkspaceInit,
    onUnlockError: () => {
      retrieved.value = true;
    },
  });
  const { appEncryptionGate, restoreEncryptionKeys, refreshEncryptionGate, handleEncryptionUnlocked } =
    encryptionGate;

  const handleDeepLink = async (payload) => {
    try {
      const raw = typeof payload === 'string' ? payload : payload?.url || payload?.path || '';
      const path = raw.replace(/^beaver-notes:\/\//, '');
      if (path.startsWith('join/')) {
        const token = path.slice('join/'.length);
        if (!token) return;
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
        if (!backend.isTouchRuntime()) {
          const copy = translations.value.app || {};
          notify({
            title: copy.updateAvailableTitle || 'Update available',
            body:
              copy.updateAvailableBody ||
              bannerData.content ||
              'An update is ready to install.',
          }).catch(() => {});
        }
      }),
      backend.listen('spellcheck-changed', () => {}),
      backend.listen('deep-link://received', (_, payload) => {
        handleDeepLink(payload);
      })
    );

    // ponytail: native ready plus safe-area must never block first paint on iOS, run in background with timeouts
    const nativeReady = Promise.allSettled([
      withTimeout(appReady(), 2000, 'appReady').catch((e) =>
        console.warn('[app] appReady failed:', e?.message || e)
      ),
      withTimeout(initializeSafeAreaInsets(), 2000, 'safeArea').catch((e) =>
        console.warn('[app] safeArea failed:', e?.message || e)
      ),
    ]);

    initializeMobileKeyboardTracking(unlistenFns);

    try {
      const managed = await withTimeout(isUpdateManaged(), 1500, 'isUpdateManaged');
      if (!managed) {
        const autoUpdateEnabled = await withTimeout(getAutoUpdateStatus(), 1500, 'getAutoUpdateStatus').catch(() => false);
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
      console.warn('Error checking auto-update status:', error?.message || error);
    }

    // Always run workspace init even if nativeReady pending: retrieved set sync so UI paints.
    try {
      await withTimeout(initializeWorkspace(), 8000, 'initializeWorkspace');
    } catch (error) {
      console.error('Error initializing workspace:', error?.message || error);
      try {
        const [hasData, onboardingCompleted] = await Promise.all([
          withTimeout(hasExistingWorkspaceData(), 2000, 'hasExistingWorkspaceData').catch(() => false),
          withTimeout(settingsStorage.get('onboardingCompleted', false), 1500, 'onboardingCompleted').catch(() => false),
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
    } finally {
      // No await: let it settle in background.
      void nativeReady;
    }

    removeBeforeRouteGuard = router.beforeEach((to, from, next) => {
      animateRouteChange.value =
        Boolean(from.name) && to.fullPath !== from.fullPath;
      next();
    });
    removeRouteGuard = router.afterEach(async () => {
      await nextTick();
      const mainEl = document.querySelector('[data-testid="app-main"]');
      if (mainEl) mainEl.scrollTop = 0;
    });
  });

  function handleVisibilityChange() {
    if (document.hidden) {
      const engine = getSyncEngine();
      if (engine) engine.flush().catch(() => {});
      engine?.stopPullTimer();
    } else {
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
        // Read once; raw content is reused for title extraction and import.
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
    undoBannerWrapperStyle,
    getTopLevelRouteKey,
    handleUpdateDismiss,
    handleUpdateInstall: () => handleUpdateInstall(installUpdate),
    initializeWorkspace,
    mainStyle,
    mobileNavbarStyle,
    retrieved,
    showMobileNavbar,
    showSidebar,
    state,
    store,
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
