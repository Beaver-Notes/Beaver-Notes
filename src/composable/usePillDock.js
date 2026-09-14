import { ref } from 'vue';

// Shared expansion state for the bottom pill dock (Dynamic Island style).
// Module-level so every pill reads the same value; `null` means the user has
// not chosen yet and the default (recording expanded) applies.
const expandedPill = ref(null);

export function usePillDock() {
  function toggle(name) {
    expandedPill.value = expandedPill.value === name ? null : name;
  }

  return { expandedPill, toggle };
}
