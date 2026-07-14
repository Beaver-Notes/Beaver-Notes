import { ref, onUnmounted } from 'vue';
import { createFocusTrap } from 'focus-trap';

export function useFocusTrap(containerRef, options = {}) {
  const isActive = ref(false);
  let trap = null;

  function activate() {
    if (isActive.value || !containerRef.value) return;
    try {
      trap = createFocusTrap(containerRef.value, {
        escapeDeactivates: true,
        returnFocusOnDeactivate: true,
        allowOutsideClick: true,
        ...options,
      });
      trap.activate();
      isActive.value = true;
    } catch {
      // Silently catch — component functions without trapping
    }
  }

  function deactivate() {
    if (!isActive.value || !trap) return;
    try {
      trap.deactivate();
    } catch {
      // Silently catch
    }
    isActive.value = false;
    trap = null;
  }

  onUnmounted(() => {
    deactivate();
  });

  return { isActive, activate, deactivate };
}
