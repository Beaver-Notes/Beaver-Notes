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

// Never stub localhost:4000 fetch: integration probes /health and auto-skips without backend.

// happy-dom localStorage undefined without flag: shim in-memory since modules read at import.
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
