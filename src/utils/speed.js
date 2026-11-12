/** Start named timer. Records the duration into the always-on perf recorder
 * (dumpable via `window.__beaverPerf.summary()`), console.warns only when
 * explicitly enabled with window.__BEAVER_SPEED_LOG__ in devtools. */
export function speed(name) {
  const t0 = performance.now();
  return {
    end: () => {
      const ms = performance.now() - t0;
      try {
        window.__beaverPerf?.span(`speed:${name}`, Math.round(ms * 100) / 100);
      } catch {
        /* recorder not ready */
      }
      if (import.meta.env.DEV && window.__BEAVER_SPEED_LOG__ === true && ms >= 1) {
        console.warn(`[speed] ${name} took ${ms.toFixed(1)}ms`);
      }
    },
  };
}