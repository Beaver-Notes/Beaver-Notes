import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

async function findAppPage(electronApp, timeoutMs = 120_000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const windows = electronApp.windows();

    for (const candidate of windows) {
      try {
        await candidate.waitForLoadState('domcontentloaded', { timeout: 5_000 });
      } catch {
        // ignore transient load timeouts while app is booting
      }

      const hasBridge = await candidate
        .evaluate(() => Boolean(globalThis.electron?.ipcRenderer))
        .catch(() => false);

      const hasUi = await candidate
        .evaluate(() =>
          Boolean(
            globalThis.document.querySelector('[data-testid="add-note-button"]') ||
              globalThis.document.querySelector('[data-testid="app-main"]'),
          ),
        )
        .catch(() => false);

      if (hasBridge || hasUi) return candidate;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return null;
}

async function launchApp(portableDir) {
  const electronApp = await electron.launch({
    args: [repoRoot],
    env: {
      ...process.env,
      MODE: 'test',
      PORTABLE_EXECUTABLE_DIR: portableDir,
      ELECTRON_DISABLE_UPDATER: '1',
      CI: '1',
    },
  });

  await electronApp.firstWindow();

  const page = await findAppPage(electronApp);
  if (!page) {
    const diagnostics = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((w) => {
        const prefs = w.webContents.getLastWebPreferences
          ? w.webContents.getLastWebPreferences()
          : {};
        return {
          title: w.getTitle(),
          url: w.webContents.getURL(),
          preload: prefs?.preload || null,
          contextIsolation: prefs?.contextIsolation ?? null,
        };
      }),
    );
    throw new Error(
      `Could not find app window with preload bridge. windows=${JSON.stringify(diagnostics)}`,
    );
  }

  const startupErrors = [];
  page.on('pageerror', (error) => startupErrors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') startupErrors.push(msg.text());
  });

  await expect
    .poll(
      async () =>
        page.evaluate(() => Boolean(globalThis.electron?.ipcRenderer)),
      { timeout: 120_000 },
    )
    .toBe(true);

  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            Boolean(
              globalThis.document.querySelector(
                '[data-testid="add-note-button"]',
              ) ||
                globalThis.document.querySelector(
                  '[data-testid="app-main"]',
                ),
            ),
        ),
      { timeout: 120_000 },
    )
    .toBe(true);

  return { electronApp, page, startupErrors };
}

test('creates a note and persists content across relaunch', async () => {
  const portableDir = mkdtempSync(path.join(tmpdir(), 'beaver-notes-e2e-'));
  const title = `E2E Persist ${Date.now()}`;
  const body = `Persisted body ${Date.now()}`;

  let firstRun;
  try {
    firstRun = await launchApp(portableDir);

    await firstRun.page.locator('[data-testid="add-note-button"]').click();
    await firstRun.page
      .locator('[data-testid="note-title-input"]')
      .waitFor({ state: 'visible', timeout: 120_000 });
    await firstRun.page.locator('[data-testid="note-title-input"]').fill(title);

    const editor = firstRun.page.locator('.ProseMirror').first();
    await editor.click();
    await editor.type(body);

    const noteId = await firstRun.page.evaluate(() => {
      const hash = globalThis.location.hash || '';
      const match = hash.match(/#\/note\/([^?]+)/);
      return match ? match[1] : null;
    });
    expect(noteId).toBeTruthy();

    await expect
      .poll(
        async () =>
          firstRun.page.evaluate(async (id) => {
            const note = await globalThis.electron.ipcRenderer.callMain(
              'storage:get',
              { name: 'data', key: `notes.${id}`, def: null },
            );
            return {
              hasTitle: note?.title?.length > 0,
              hasBody: JSON.stringify(note?.content || {}).includes('Persisted body'),
            };
          }, noteId),
        { timeout: 60_000 },
      )
      .toEqual({ hasTitle: true, hasBody: true });

    await firstRun.electronApp.close();

    const secondRun = await launchApp(portableDir);
    try {
      await secondRun.page.evaluate((id) => {
        globalThis.location.hash = `#/note/${id}`;
      }, noteId);
      await secondRun.page
        .locator('[data-testid="note-title-input"]')
        .waitFor({ state: 'visible', timeout: 120_000 });
      await expect(secondRun.page.locator('[data-testid="note-title-input"]')).toContainText(
        title,
      );
      await expect(secondRun.page.locator('.ProseMirror').first()).toContainText(
        body,
      );
    } finally {
      await secondRun.electronApp.close();
    }
  } finally {
    if (firstRun) {
      if (firstRun.startupErrors.length > 0) {
        console.error('startup errors:', firstRun.startupErrors);
      }
      try {
        await firstRun.electronApp.close();
      } catch {
        // ignore close errors when the app is already closed
      }
    }
    rmSync(portableDir, { recursive: true, force: true });
  }
});

test('blocks unknown storage namespaces through IPC', async () => {
  const portableDir = mkdtempSync(path.join(tmpdir(), 'beaver-notes-e2e-'));

  let run;
  try {
    run = await launchApp(portableDir);

    const result = await run.page.evaluate(async () => {
      const ipc = globalThis.electron.ipcRenderer;

      await ipc.callMain('storage:set', {
        name: 'settings',
        key: 'e2e.flag',
        value: 'ok',
      });

      const allowed = await ipc.callMain('storage:get', {
        name: 'settings',
        key: 'e2e.flag',
        def: null,
      });

      await ipc.callMain('storage:set', {
        name: 'unknown',
        key: 'e2e.flag',
        value: 'should-not-persist',
      });

      const blocked = await ipc.callMain('storage:get', {
        name: 'unknown',
        key: 'e2e.flag',
        def: 'fallback',
      });

      const hasBlocked = await ipc.callMain('storage:has', {
        name: 'unknown',
        key: 'e2e.flag',
      });

      return { allowed, blocked, hasBlocked };
    });

    expect(result.allowed).toBe('ok');
    expect(result.blocked).toBe('fallback');
    expect(result.hasBlocked).toBe(false);
  } finally {
    if (run) {
      if (run.startupErrors.length > 0) {
        console.error('startup errors:', run.startupErrors);
      }
      await run.electronApp.close();
    }
    rmSync(portableDir, { recursive: true, force: true });
  }
});
