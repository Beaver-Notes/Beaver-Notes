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
        // Never yank focus (and the mobile keyboard with it) on touch
        // sheets — Vaul/reka mobile sheets don't autofocus either; the
        // viewport resize behind the keyboard is what freezes inner
        // scrollers like the block picker grid on first open.
        initialFocus:
          window.matchMedia?.('(pointer: coarse)').matches === true
            ? false
            : undefined,
        preventScroll: true,
        ...options,
      });
      trap.activate();
      isActive.value = true;
    } catch {
      // Silent catch: component works without trapping.
    }
  }

  function deactivate() {
    if (!isActive.value || !trap) return;
    try {
      trap.deactivate();
    } catch {
    }
    isActive.value = false;
    trap = null;
  }

  onUnmounted(() => {
    deactivate();
  });

  return { isActive, activate, deactivate };
}
