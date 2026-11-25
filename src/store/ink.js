import { ref } from 'vue';
import { defineStore } from 'pinia';

/**
 * ink store — app-chrome state for the ink surfaces (REDESIGN phase F, A7).
 * Single source of truth for "is a stroke in progress" so every chrome
 * consumer (toolbar, sidebar) locks consistently instead of module-level refs.
 */
export const useInkStore = defineStore('ink', () => {
  const strokeActive = ref(false);

  function setStrokeActive(active) {
    strokeActive.value = !!active;
  }

  return { strokeActive, setStrokeActive };
});
