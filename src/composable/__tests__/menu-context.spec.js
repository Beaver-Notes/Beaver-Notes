import { describe, it, expect, vi } from 'vitest';

const { updateMenu } = vi.hoisted(() => ({ updateMenu: vi.fn() }));

vi.mock('@/lib/native/app', () => ({
  updateMenu,
  getNativeDarkTheme: vi.fn(async () => false),
  appReady: vi.fn(async () => {}),
  notify: vi.fn(async () => {}),
  setMenuVisibility: vi.fn(),
  setZoomLevel: vi.fn(),
  checkForUpdates: vi.fn(async () => {}),
  getAutoUpdateStatus: vi.fn(async () => false),
  installUpdate: vi.fn(),
  isUpdateManaged: vi.fn(async () => false),
}));
vi.mock('@/lib/tauri-bridge', () => ({
  backend: {
    isMobileRuntime: () => false,
    isPhoneRuntime: () => false,
    isDesktopRuntime: () => true,
  },
  onFileOpened: vi.fn(() => () => {}),
  addCloseHandler: vi.fn(),
}));

// Extract a pure `buildMenuContext({ routeName, noteEditable, noteLocked, inReaderMode })`
// helper from useAppShell so it is unit-testable without mounting.
import { buildMenuContext } from '../useAppShell.js';

describe('menu context', () => {
  it('omits edit menus for a locked note', () => {
    const ctx = buildMenuContext({ routeName: 'Note', noteEditable: false, noteLocked: true, inReaderMode: false });
    expect(ctx.screen).toBe('note');
    expect(ctx.noteEditable).toBe(false);
    expect(ctx.noteLocked).toBe(true);
  });

  it('maps the reader-mode route to the reader screen', () => {
    const ctx = buildMenuContext({ routeName: 'Note', inReaderMode: true });
    expect(ctx.screen).toBe('reader');
  });
});
