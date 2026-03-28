import { computed, onUnmounted, ref, watch } from 'vue';

const ONBOARDING_ROUTE_NAME = 'Onboarding';

export function useAppShellLayout({ store, route, backend }) {
  const keyboardVisible = ref(false);
  const isMobileRuntime = computed(() => backend.isMobileRuntime());
  const showSidebar = computed(
    () => !store.inReaderMode && route.name !== ONBOARDING_ROUTE_NAME
  );
  const showMobileNavbar = computed(
    () =>
      showSidebar.value &&
      route.name !== 'Note' &&
      (!isMobileRuntime.value || !keyboardVisible.value)
  );
  const useMobileBottomDockSpacing = computed(
    () => isMobileRuntime.value && showMobileNavbar.value
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
    keyboardVisible.value = hasEditableFocus && keyboardDelta > 120;
  };

  watch(
    showMobileNavbar,
    (visible) => {
      if (typeof document === 'undefined' || !isMobileRuntime.value) return;
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
        visible ? '0px' : 'var(--app-safe-area-bottom)'
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
        keyboardVisible.value = true;
      }),
      backend.listen('keyboard_hidden', () => {
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

  return {
    bottomBannerStyle,
    initializeMobileKeyboardTracking,
    initializeSafeAreaInsets,
    mainStyle,
    mobileNavbarStyle,
    showMobileNavbar,
    showSidebar,
  };
}
