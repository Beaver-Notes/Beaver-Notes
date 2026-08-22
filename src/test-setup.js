// Vitest setup for source-level unit tests.

// happy-dom exposes a `localStorage` slot on the window, but its value is
// `undefined` unless Node runs with `--localstorage-file`. Several app modules
// (e.g. src/utils/sync/sync-repository.js, src/lib/settings) read
// localStorage at import time, so give every test an in-memory shim.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}
