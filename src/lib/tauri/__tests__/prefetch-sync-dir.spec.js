import { describe, expect, it, vi, beforeEach } from 'vitest';
import { prefetchSyncDir } from '../scoped-storage.js';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('tauri-plugin-scoped-storage-api', () => ({
  exists: vi.fn(),
  getFolderInfo: vi.fn(),
  mkdir: vi.fn(),
  pickFolder: vi.fn(),
  readDir: vi.fn(),
  readFile: vi.fn(),
  removeDir: vi.fn(),
  removeFile: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn(),
}));

async function mockedInvoke() {
  return (await import('@tauri-apps/api/core')).invoke;
}

describe('prefetchSyncDir', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no-ops on plain paths without touching the bridge', async () => {
    const invoke = await mockedInvoke();
    const result = await prefetchSyncDir('/Users/me/sync');
    expect(result.complete).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('kicks off downloads then resolves complete when nothing is pending', async () => {
    const invoke = await mockedInvoke();
    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'plugin:scoped-storage|warm_folder') return { warmed: 2 };
      return { total: 2, downloaded: 2, pending: 0 };
    });

    const result = await prefetchSyncDir('scoped:folder1/commits', {
      pollMs: 1,
    });
    expect(invoke).toHaveBeenCalledWith(
      'plugin:scoped-storage|warm_folder',
      { req: { folderId: 'folder1', path: 'commits' } }
    );
    expect(result).toMatchObject({
      complete: true,
      total: 2,
      downloaded: 2,
      pending: 0,
    });
  });

  it('waits through pending polls until downloads land', async () => {
    const invoke = await mockedInvoke();
    let polls = 0;
    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'plugin:scoped-storage|warm_folder') return { warmed: 3 };
      polls += 1;
      return polls < 3
        ? { total: 3, downloaded: 0, pending: 3 }
        : { total: 3, downloaded: 3, pending: 0 };
    });

    const result = await prefetchSyncDir('scoped:folder1', { pollMs: 1 });
    expect(result.complete).toBe(true);
    expect(polls).toBeGreaterThanOrEqual(3);
  });

  it('bails to local-files behavior on stall instead of hanging sync', async () => {
    const invoke = await mockedInvoke();
    invoke.mockResolvedValue({ total: 9, downloaded: 1, pending: 8 });
    const { logger } = await import('@/utils/logger.js');

    const started = Date.now();
    const result = await prefetchSyncDir('scoped:folder1', {
      pollMs: 5,
      stallMs: 30,
      timeoutMs: 60_000,
    });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(result).toMatchObject({ complete: false, pending: 8 });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('bails on timeout even while progress keeps moving', async () => {
    const invoke = await mockedInvoke();
    let pending = 100;
    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'plugin:scoped-storage|warm_folder') return { warmed: 100 };
      pending -= 1; // always advancing, but too slowly
      return { total: 100, downloaded: 100 - pending, pending };
    });

    const result = await prefetchSyncDir('scoped:folder1', {
      pollMs: 5,
      stallMs: 60_000,
      timeoutMs: 40,
    });
    expect(result.complete).toBe(false);
  });

  it('never throws when the bridge is missing (desktop, old plugin)', async () => {
    const invoke = await mockedInvoke();
    invoke.mockRejectedValue(new Error('no such command'));
    const result = await prefetchSyncDir('scoped:folder1', { pollMs: 1 });
    expect(result.complete).toBe(false);
  });

  it('lets the UI breathe while waiting: event loop turns over during the gate', async () => {
    const invoke = await mockedInvoke();
    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'plugin:scoped-storage|warm_folder') return { warmed: 4 };
      // Slow IPC: each status round-trip takes 20ms of wall time.
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { total: 4, downloaded: 4, pending: 0 };
    });

    // A UI pump: stands in for input handling / navigation. If the gate ever
    // blocked the thread, this counter would barely move while we await it.
    let uiTicks = 0;
    let gateOpen = false;
    let lastTick = Date.now();
    let maxGap = 0;
    const pump = () => {
      const now = Date.now();
      maxGap = Math.max(maxGap, now - lastTick);
      lastTick = now;
      uiTicks += 1;
      if (!gateOpen) setTimeout(pump, 0);
    };
    setTimeout(pump, 0);

    const result = await prefetchSyncDir('scoped:folder1', { pollMs: 5 });
    gateOpen = true;

    expect(result.complete).toBe(true);
    expect(uiTicks).toBeGreaterThan(3);
    // Jank budget: the UI thread is never held for a perceptible stretch.
    expect(maxGap).toBeLessThan(200);
  });
});
