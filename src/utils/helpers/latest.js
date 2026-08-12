// ─── Debounced async executor ─────────────────────────────────────────────────

/**
 * Returns a debounced wrapper around an async `executor`.
 *
 * Repeated calls within `delayMs` are collapsed into a single execution of the
 * *last* invocation. Returns a promise that resolves with the result of that
 * execution.
 */
export function createDebouncedLatest(executor, delayMs = 200) {
  let timer = null;

  return (...args) =>
    new Promise((resolve, reject) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        executor(...args).then(resolve, reject);
      }, delayMs);
    });
}
