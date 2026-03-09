import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { Builder, By, Capabilities, until } from 'selenium-webdriver';

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const RESULT_DIR = path.join(ROOT_DIR, 'test-results', 'desktop');
const SCREENSHOT_PATH = path.join(RESULT_DIR, 'desktop-smoke-failure.png');
const TAURI_CLI = path.join(
  ROOT_DIR,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tauri.cmd' : 'tauri'
);
const APP_BINARY = path.join(
  ROOT_DIR,
  'src-tauri',
  'target',
  'debug',
  process.platform === 'win32' ? 'beaver-notes.exe' : 'beaver-notes'
);

function ensureResultsDir() {
  mkdirSync(RESULT_DIR, { recursive: true });
}

function runOrThrow(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      TAURI_WEBVIEW_AUTOMATION: 'true',
    },
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with status ${result.status}`
    );
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function createDriver() {
  const capabilities = new Capabilities();
  capabilities.set('tauri:options', {
    application: process.env.TAURI_APPLICATION_PATH || APP_BINARY,
  });

  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await new Builder()
        .usingServer('http://127.0.0.1:4444/')
        .withCapabilities(capabilities)
        .build();
    } catch (error) {
      lastError = error;
      await sleep(500);
    }
  }

  throw lastError;
}

async function waitForText(driver, locator, expected, message) {
  await driver.wait(
    async () => {
      const element = await driver.findElement(locator);
      const text = await element.getText();
      return text.includes(expected);
    },
    15_000,
    message
  );
}

async function runSmokeTest(driver) {
  const title = `Desktop smoke ${Date.now()}`;
  const body = `Body ${Date.now()} persists through reload`;

  const addNoteButton = await driver.wait(
    until.elementLocated(By.css('[data-testid="add-note-button"]')),
    30_000
  );
  await addNoteButton.click();

  const titleInput = await driver.wait(
    until.elementLocated(By.css('[data-testid="note-title-input"]')),
    15_000
  );
  await titleInput.click();
  await titleInput.sendKeys(title);

  const bodyEditor = await driver.wait(
    until.elementLocated(By.css('[data-testid="note-body-editor"]')),
    15_000
  );
  await bodyEditor.click();
  await bodyEditor.sendKeys(body);

  await sleep(750);
  await driver.navigate().refresh();

  await driver.wait(
    until.elementLocated(By.css('[data-testid="note-title-input"]')),
    15_000
  );
  await waitForText(
    driver,
    By.css('[data-testid="note-title-input"]'),
    title,
    'Saved title did not reappear after reload'
  );
  await waitForText(
    driver,
    By.css('[data-testid="note-body-editor"]'),
    body,
    'Saved body did not reappear after reload'
  );

  const notesNavButton = await driver.findElement(
    By.css('[data-testid="nav-notes-button"]')
  );
  await notesNavButton.click();

  await driver.wait(
    async () => {
      const elements = await driver.findElements(
        By.css('[data-testid="note-card-title"]')
      );
      const texts = await Promise.all(
        elements.map((element) => element.getText())
      );
      return texts.some((text) => text.includes(title));
    },
    15_000,
    'Created note did not appear in the notes list'
  );

  const titles = await Promise.all(
    (
      await driver.findElements(By.css('[data-testid="note-card-title"]'))
    ).map((element) => element.getText())
  );
  assert.ok(
    titles.some((text) => text.includes(title)),
    'Expected created note title to be visible in the notes list'
  );
}

async function main() {
  ensureResultsDir();

  if (!existsSync(TAURI_CLI)) {
    throw new Error(
      `Tauri CLI not found at ${TAURI_CLI}. Run yarn install first.`
    );
  }

  runOrThrow(TAURI_CLI, ['build', '--debug', '--no-bundle']);

  const tauriDriver = spawn(
    process.env.TAURI_DRIVER_PATH || 'tauri-driver',
    process.env.TAURI_NATIVE_DRIVER_PATH
      ? ['--native-driver', process.env.TAURI_NATIVE_DRIVER_PATH]
      : [],
    {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      env: {
        ...process.env,
        TAURI_WEBVIEW_AUTOMATION: 'true',
      },
    }
  );

  let driver;
  try {
    driver = await createDriver();
    await runSmokeTest(driver);
    console.log('Linux desktop smoke test passed.');
  } catch (error) {
    if (driver) {
      try {
        const screenshot = await driver.takeScreenshot();
        writeFileSync(SCREENSHOT_PATH, screenshot, 'base64');
      } catch {
        // Ignore secondary screenshot failures.
      }
    }
    throw error;
  } finally {
    if (driver) {
      await driver.quit();
    }
    if (!tauriDriver.killed) {
      tauriDriver.kill('SIGTERM');
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
