// tests/unit/setup.js
import { vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// happy-dom does not expose a persistent localStorage by default; the settings
// composable reads/writes it synchronously, so we provide a minimal in-memory
// implementation that mirrors the browser API.
const _ls = new Map();
vi.stubGlobal('localStorage', {
  getItem: (k) => (_ls.has(k) ? _ls.get(k) : null),
  setItem: (k, v) => _ls.set(k, String(v)),
  removeItem: (k) => _ls.delete(k),
  clear: () => _ls.clear(),
  key: (i) => [..._ls.keys()][i] ?? null,
  get length() {
    return _ls.size;
  },
});

// ── Low-level Tauri primitives ───────────────────────────────────────────────
// The stores never call @tauri-apps/* directly, but they reach it through
// @/lib/tauri-bridge and the native/* wrappers. We stub the real Tauri runtime
// so no native backend is required. These are honest no-ops: every invoke
// resolves to null (the "no data" default), matching a fresh/empty backend.

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => null),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(async () => {}),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({
    setZoom: vi.fn(async () => {}),
    setResizable: vi.fn(async () => {}),
  })),
}));

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  readText: vi.fn(async () => ''),
  writeText: vi.fn(async () => {}),
}));

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn(async () => false),
  requestPermission: vi.fn(async () => 'denied'),
  sendNotification: vi.fn(() => {}),
}));

vi.mock('tauri-plugin-scoped-storage-api', () => ({
  exists: vi.fn(async () => false),
  getFolderInfo: vi.fn(async () => ({})),
  mkdir: vi.fn(async () => {}),
  pickFolder: vi.fn(async () => null),
  readDir: vi.fn(async () => []),
  readFile: vi.fn(async () => null),
  removeDir: vi.fn(async () => {}),
  removeFile: vi.fn(async () => {}),
  stat: vi.fn(async () => ({})),
  writeFile: vi.fn(async () => {}),
}));

// ── Heavy editor modules ─────────────────────────────────────────────────────
// @/lib/tiptap instantiates full TipTap Editors at module load; @tiptap/y-tiptap
// is pulled by the Yjs meta-doc hydration. Neither is under test here, so we
// stub the named exports the store dependency graph references.

vi.mock('@/lib/tiptap', () => ({
  extensions: [],
  yjsExtensions: [],
  createBaseExtensions: vi.fn(() => []),
  CollapseHeading: {},
  heading: {},
  dropFile: {},
  Commands: {},
  prewarmEditor: vi.fn(() => {}),
  default: vi.fn(() => ({})),
}));

vi.mock('@tiptap/y-tiptap', () => ({
  prosemirrorJSONToYDoc: vi.fn(() => ({})),
  yXmlFragmentToProsemirrorJSON: vi.fn(() => ({ type: 'doc', content: [] })),
}));

// ── The commands module (per task brief) ─────────────────────────────────────

vi.mock('@/lib/tauri/commands', () => ({
  invokeCommand: vi.fn(async () => null),
}));
import { invokeCommand } from '@/lib/tauri/commands';

beforeEach(() => {
  setActivePinia(createPinia());
  vi.mocked(invokeCommand).mockReset();
});
