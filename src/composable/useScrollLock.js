let lockCount = 0;
let originalOverflow = '';
let originalPaddingRight = '';

/**
 * Composable to lock body scroll when overlays/popovers/menus are open.
 * Uses a counter to support multiple simultaneous open elements.
 */
export function useScrollLock() {
  function lock() {
    if (lockCount === 0) {
      originalOverflow = document.body.style.overflow;
      originalPaddingRight = document.body.style.paddingRight;

      const scrollbarWidth =
        window.innerWidth - document.documentElement.clientWidth;
      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`;
      }
      document.body.style.overflow = 'hidden';
    }
    lockCount++;
  }

  function unlock() {
    if (lockCount > 0) {
      lockCount--;
      if (lockCount === 0) {
        document.body.style.overflow = originalOverflow;
        document.body.style.paddingRight = originalPaddingRight;
      }
    }
  }

  return { lock, unlock };
}
