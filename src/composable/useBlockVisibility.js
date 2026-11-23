import { ref, onMounted, onUnmounted } from 'vue';

/**
 * Returns a ref that flips true once the element approaches the viewport.
 * The render-side complement of content-visibility: heavy blocks (diagrams,
 * PDFs, drawings) defer expensive rendering until they are actually on screen.
 * Falls back to immediately-visible when IntersectionObserver is unavailable
 * or the element can't be resolved (tests, hidden mounts).
 */
export function useBlockVisibility(getEl, { rootMargin = '600px 0px' } = {}) {
  const visible = ref(false);
  let io = null;
  onMounted(() => {
    const el = typeof getEl === 'function' ? getEl() : getEl;
    // happy-dom (test env) defines an IntersectionObserver that never fires
    // its callbacks; gate on it explicitly so tests see the un-gated path.
    if (
      !el ||
      typeof IntersectionObserver === 'undefined' ||
      (typeof window !== 'undefined' && window.happyDOM)
    ) {
      visible.value = true;
      return;
    }
    io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visible.value = true;
            if (io) {
              io.disconnect();
              io = null;
            }
            break;
          }
        }
      },
      { rootMargin },
    );
    io.observe(el);
  });
  onUnmounted(() => {
    if (io) io.disconnect();
  });
  return visible;
}
