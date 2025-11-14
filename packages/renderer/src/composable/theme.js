import { ref, onMounted, onUnmounted } from 'vue';

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

  if (isSystem) {
    localStorage.removeItem('theme');
  } else {
    localStorage.theme = name;
  }

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
  const savedTheme = localStorage.getItem('theme') || 'system';
  window.electron.ipcRenderer.callMain('theme:set', savedTheme);
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
