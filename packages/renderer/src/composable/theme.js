import { ref } from 'vue';

const currentTheme = ref('');

function isDark() {
  if (currentTheme.value === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  return currentTheme.value === 'dark';
}

function setTheme(name, isSystem) {
  const rootElement = document.documentElement;

  currentTheme.value = isSystem ? 'system' : name;

  if (name === 'dark' && !rootElement.classList.contains('dark')) {
    rootElement.classList.add('dark');
  } else if (name === 'light') {
    rootElement.classList.remove('dark');
  } else if (name === 'system') {
    localStorage.removeItem('theme');

    setTheme(isDark() ? 'dark' : 'light', true);
  }

  localStorage.theme = currentTheme.value;
}

function loadTheme() {
  const theme = localStorage.getItem('theme') || 'system';

  currentTheme.value = theme;

  if (localStorage.theme === 'dark' || (theme === 'system' && isDark())) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

export function useTheme() {
  return {
    isDark,
    setTheme,
    loadTheme,
    currentTheme,
  };
}
