import { ref, readonly } from 'vue';

const STORAGE_KEY = 'sidebarExpanded';

const expanded = ref(localStorage.getItem(STORAGE_KEY) !== 'false');

function setExpanded(value) {
  expanded.value = value;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    /* storage unavailable */
  }
}

function toggleExpanded() {
  setExpanded(!expanded.value);
}

export function useSidebar() {
  return {
    expanded: readonly(expanded),
    setExpanded,
    toggleExpanded,
  };
}
