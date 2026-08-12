/**
 * Start a named timer. Returns `null` when disabled (no-op on `.end()`).
 *
 * Enable by setting `window.__BEAVER_SPEED_LOG__ = true` in the devtools console.
 *
 *   const t = speed('note_open');
 *   await load(id);
 *   t?.end();
 *
 * Cleanup before shipping to production:
 *   1. `rg -l "speed\(" src/` and delete each call.
 *   2. Delete this file.
 */
export function speed(name) {
  if (!import.meta.env.DEV || window.__BEAVER_SPEED_LOG__ !== true) return null;
  const t0 = performance.now();
  return {
    end: () => {
      const ms = performance.now() - t0;
      if (ms >= 1) console.warn(`[speed] ${name} took ${ms.toFixed(1)}ms`);
    },
  };
}