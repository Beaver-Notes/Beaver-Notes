import { ref, onMounted, onUnmounted } from 'vue';
import { getSettingSync, setSetting } from './settings';
import { backend } from '@/lib/tauri-bridge';
import { getNativeDarkTheme } from '@/lib/native/app';
const currentTheme = ref('');
const resolvedDarkTheme = ref(
  typeof document !== 'undefined' &&
    document.documentElement.classList.contains('dark')
);

let mediaQuery = null;
let mediaQueryListener = null;
let cleanupThemeSync = null;
let themeComposableUsers = 0;
let themeSurfaceSyncFrame = null;

function ensureThemeColorMeta() {
  if (typeof document === 'undefined') return null;

  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }

  return meta;
}

function syncDocumentThemeSurface() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  if (themeSurfaceSyncFrame !== null) {
    window.cancelAnimationFrame(themeSurfaceSyncFrame);
  }

  themeSurfaceSyncFrame = window.requestAnimationFrame(() => {
    themeSurfaceSyncFrame = null;

    const rootElement = document.documentElement;
    const body = document.body;
    const appBackground =
      window
        .getComputedStyle(rootElement)
        .getPropertyValue('--app-theme-background')
        .trim() || window.getComputedStyle(rootElement).backgroundColor;

    rootElement.style.colorScheme = resolvedDarkTheme.value ? 'dark' : 'light';

    if (body && appBackground) {
      body.style.backgroundColor = appBackground;
    }

    const meta = ensureThemeColorMeta();
    if (meta && appBackground) {
      meta.setAttribute('content', appBackground);
    }
  });
}

function getBrowserDarkPreference() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function isDark() {
  return resolvedDarkTheme.value;
}

function applyResolvedTheme(isDarkTheme) {
  const rootElement = document.documentElement;
  resolvedDarkTheme.value = Boolean(isDarkTheme);

  if (isDarkTheme) {
    rootElement.classList.add('dark');
  } else {
    rootElement.classList.remove('dark');
  }

  syncDocumentThemeSurface();
}

function clearSystemThemeSync() {
  if (themeSurfaceSyncFrame !== null && typeof window !== 'undefined') {
    window.cancelAnimationFrame(themeSurfaceSyncFrame);
    themeSurfaceSyncFrame = null;
  }

  if (mediaQuery && mediaQueryListener) {
    if (typeof mediaQuery.removeEventListener === 'function') {
      mediaQuery.removeEventListener('change', mediaQueryListener);
    } else if (typeof mediaQuery.removeListener === 'function') {
      mediaQuery.removeListener(mediaQueryListener);
    }
  }

  mediaQuery = null;
  mediaQueryListener = null;
  cleanupThemeSync?.();
  cleanupThemeSync = null;
}

async function syncSystemThemeFromNative() {
  if (currentTheme.value !== 'system') return;

  try {
    const nativeDark = await getNativeDarkTheme();
    applyResolvedTheme(nativeDark);
  } catch {
    applyResolvedTheme(getBrowserDarkPreference());
  }
}

function ensureSystemThemeSync() {
  clearSystemThemeSync();

  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQueryListener = (event) => {
    if (currentTheme.value !== 'system') return;
    applyResolvedTheme(event.matches);
    void syncSystemThemeFromNative();
  };

  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', mediaQueryListener);
  } else if (typeof mediaQuery.addListener === 'function') {
    mediaQuery.addListener(mediaQueryListener);
  }

  const handleVisibilityOrFocus = () => {
    if (currentTheme.value !== 'system') return;
    void syncSystemThemeFromNative();
  };

  window.addEventListener('focus', handleVisibilityOrFocus);
  document.addEventListener('visibilitychange', handleVisibilityOrFocus);

  const unlistenPromise = backend.listenPayload(
    'system-theme-changed',
    ({ dark }) => {
      if (currentTheme.value !== 'system') return;
      applyResolvedTheme(Boolean(dark));
    }
  );

  cleanupThemeSync = () => {
    window.removeEventListener('focus', handleVisibilityOrFocus);
    document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    Promise.resolve(unlistenPromise)
      .then((unlisten) => unlisten?.())
      .catch(() => {});
  };
}

function setTheme(name, isSystem = false) {
  clearSystemThemeSync();

  currentTheme.value = isSystem ? 'system' : name;

  if (currentTheme.value === 'system') {
    applyResolvedTheme(getBrowserDarkPreference());
    ensureSystemThemeSync();
    void syncSystemThemeFromNative();
  } else {
    applyResolvedTheme(currentTheme.value === 'dark');
  }

  void setSetting('theme', currentTheme.value);
}

function loadTheme() {
  const savedTheme = getSettingSync('theme');
  setTheme(savedTheme, savedTheme === 'system');
}

export function useTheme() {
  onMounted(() => {
    themeComposableUsers += 1;
    loadTheme();
  });

  onUnmounted(() => {
    themeComposableUsers = Math.max(0, themeComposableUsers - 1);
    if (themeComposableUsers === 0) {
      clearSystemThemeSync();
    }
  });

  return {
    isDark,
    setTheme,
    loadTheme,
    currentTheme,
    resolvedDarkTheme,
  };
}
