import { ref, onMounted, onUnmounted } from 'vue';
import { getSettingSync, setSetting } from './settings';
const currentTheme = ref('');

let mediaQueryListener = null;

function isDark() {
  if (currentTheme.value === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return currentTheme.value === 'dark';
}

function setTheme(name, isSystem = false) {
  const rootElement = document.documentElement;

  if (mediaQueryListener) {
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .removeListener(mediaQueryListener);
    mediaQueryListener = null;
  }

  currentTheme.value = isSystem ? 'system' : name;

  if (isDark()) {
    rootElement.classList.add('dark');
  } else {
    rootElement.classList.remove('dark');
  }

  void setSetting('theme', currentTheme.value);

  if (currentTheme.value === 'system') {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQueryListener = () => {
      if (currentTheme.value === 'system') {
        setTheme(mediaQuery.matches ? 'dark' : 'light', true);
      }
    };
    mediaQuery.addListener(mediaQueryListener);
  }
}

function loadTheme() {
  const savedTheme = getSettingSync('theme');
  setTheme(savedTheme, savedTheme === 'system');
}

export function useTheme() {
  onMounted(() => {
    loadTheme();
  });

  onUnmounted(() => {
    if (mediaQueryListener) {
      window
        .matchMedia('(prefers-color-scheme: dark)')
        .removeListener(mediaQueryListener);
      mediaQueryListener = null;
    }
  });

  return {
    isDark,
    setTheme,
    loadTheme,
    currentTheme,
  };
}
