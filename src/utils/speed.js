/** Start named timer, null when disabled. Enable with window.__BEAVER_SPEED_LOG__ in devtools. Cleanup: delete speed( sites, then file. */
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