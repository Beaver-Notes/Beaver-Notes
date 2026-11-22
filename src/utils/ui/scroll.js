// Animated programmatic scrolling for the app's scroll containers. Jumps
// (headings, search hits, footnote refs) glide instead of teleporting; the
// cursor restore on note open deliberately stays instant and does not use this.

const reduceMotion = () =>
  typeof window.matchMedia === 'function' &&
  (window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    document.documentElement.classList.contains('prefers-reduced-motion'));

export function scrollContainerOf(el) {
  let node = el?.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    const ov = getComputedStyle(node).overflowY;
    if (ov === 'auto' || ov === 'scroll') return node;
    node = node.parentElement;
  }
  return window;
}

const topOf = (c) => (c === window ? window.scrollY : c.scrollTop);
const rectOf = (c) =>
  c === window ? { top: 0, height: window.innerHeight } : c.getBoundingClientRect();

function setTop(c, px) {
  if (c === window) window.scrollTo(0, px);
  else c.scrollTop = px;
}

let frame = 0;

function stopGlide() {
  cancelAnimationFrame(frame);
}

/**
 * Glide the scroll toward a live target. `measure()` returns the desired
 * scrollTop (or null when unknown) and is re-read every frame, so a target
 * that moves while we travel — a block whose real height replaces its
 * `contain-intrinsic-size` placeholder on the way — is still tracked.
 */
export function scrollToTarget(scroller, measure, { duration = 450, onDone, ignoreLayoutDrift = false } = {}) {
  const c = scroller || window;
  stopGlide();
  if (reduceMotion()) {
    const goal = measure();
    if (goal != null) setTop(c, goal);
    onDone?.();
    return;
  }
  const t0 = performance.now();
  const tau = Math.max(50, duration / 4);
  let last = t0;
  // A manual scroll wins: the glide must not fight the user's wheel. We detect
  // that by comparing the scroller's actual position with the one we last set,
  // instead of listening for wheel/touch events — adding a wheel listener to a
  // scroller makes WebKit recompute the event regions of the whole document,
  // which costs hundreds of milliseconds in a note with thousands of blocks.
  let expected = topOf(c);
  const step = (now) => {
    const dt = Math.min(now - last, 64);
    last = now;
    const cur = topOf(c);
    if (!ignoreLayoutDrift && Math.abs(cur - expected) > 2) {
      stopGlide();
      onDone?.();
      return;
    }
    const goal = measure();
    if (goal == null) {
      stopGlide();
      onDone?.();
      return;
    }
    const delta = goal - cur;
    if (Math.abs(delta) < 2 || now - t0 > duration) {
      setTop(c, goal);
      stopGlide();
      onDone?.();
      return;
    }
    expected = cur + delta * (1 - Math.exp(-dt / tau));
    setTop(c, expected);
    // The scroller may clamp to its current scrollHeight while virtualization
    // grows the document. Track the position it actually reached so the next
    // frame does not mistake that clamp for a manual scroll and abort.
    expected = topOf(c);
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
}

/** Animate a container's scrollTop to a fixed position. */
export function scrollTopTo(scroller, target, { duration = 350, onDone } = {}) {
  scrollToTarget(scroller, () => target, { duration, onDone });
}

/**
 * Center a document position (ProseMirror) in its scroll container. The
 * target's top-level block always owns a box — a placeholder one while it is
 * outside the render window — so the glide has a destination even before the
 * block is laid out for real.
 */
export function centerPosInView(editor, pos, options) {
  const view = editor?.view;
  if (!view) return false;
  const scroller = scrollContainerOf(view.dom);
  const rect = rectOf(scroller);
  const center = rect.top + rect.height / 2;
  let block = null;
  try {
    block = view.dom.children[view.state.doc.resolve(pos).index(0)] || null;
  } catch {
    /* unknown position */
  }
  if (!block) return false;
  scrollToTarget(
    scroller,
    () => {
      const b = block.getBoundingClientRect();
      return topOf(scroller) + b.top - center;
    },
    { ignoreLayoutDrift: true, ...options },
  );
  return true;
}

/** Center a DOM element in its scroll container. */
export function centerElementInView(el) {
  if (!el) return;
  const scroller = scrollContainerOf(el);
  const rect = rectOf(scroller);
  const center = rect.top + rect.height / 2;
  scrollToTarget(scroller, () => {
    const r = el.getBoundingClientRect();
    return topOf(scroller) + r.top - center + r.height / 2;
  });
}
