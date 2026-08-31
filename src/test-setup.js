// Vitest setup for source-level unit tests.
import { vi } from 'vitest';

// Stub Tauri invoke so any module that imports @tauri-apps/api does not throw
// "Cannot read properties of undefined (reading 'invoke')" in happy-dom.
if (typeof globalThis.__TAURI_INTERNALS__ === 'undefined') {
  globalThis.__TAURI_INTERNALS__ = { invoke: vi.fn(async () => undefined) };
}
if (typeof globalThis.__TAURI__ === 'undefined') {
  globalThis.__TAURI__ = { invoke: vi.fn(async () => undefined), core: { invoke: vi.fn(async () => undefined) } };
}
if (typeof window !== 'undefined' && typeof window.__TAURI_INTERNALS__ === 'undefined') {
  window.__TAURI_INTERNALS__ = globalThis.__TAURI_INTERNALS__;
}

// Do not stub fetch for localhost:4000 — integration tests probe /health
// and use `reachable ? describe : describe.skip` to auto-skip when no backend.
// Stubbing health to ok:true breaks that guard and turns skips into failures.

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
