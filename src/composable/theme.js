import { ref, onMounted, onUnmounted } from 'vue';
import { getSettingSync, setSetting } from './settings';
import { backend } from '@/lib/tauri-bridge';
const currentTheme = ref('');
const resolvedDarkTheme = ref(
  typeof document !== 'undefined' &&
    document.documentElement.classList.contains('dark')
);

let mediaQuery = null;
let mediaQueryListener = null;
let cleanupThemeSync = null;
let themeComposableUsers = 0;

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
}

function clearSystemThemeSync() {
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
    const nativeDark = await backend.invoke('helper:is-dark-theme');
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
