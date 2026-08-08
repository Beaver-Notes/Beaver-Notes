import { expect } from '@wdio/globals';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Vault-join onboarding test.
 *
 * Drives the real Tauri app through onboarding and verifies that when the
 * chosen sync source already holds shared key params, the password step opens
 * in "join existing vault" mode instead of "create new vault" mode — and that
 * "Start fresh" flips back to create mode.
 *
 * The shared key params file is what a real vault publishes to the sync folder
 * (`<syncPath>/BeaverNotesSync/keyParams.json`, see src-tauri .../keys.rs
 * `publish_key_params`). It is public by design; only a device with the
 * correct passphrase can unwrap the wrapped items key. Detection only needs
 * the file to parse and differ from this device's (absent) local manifest, so
 * a syntactically valid fixture is enough for the detection assertions.
 */
const KEY_PARAMS_FIXTURE = {
  version: 1,
  kdf: 'argon2id',
  saltHex:
    'a1b2c3d4e5f60718293a4b5c6d7e8f9012233445566778899aabbccddeeff0011',
  argon2MemoryKib: 65536,
  argon2Iterations: 3,
  argon2Parallelism: 4,
  wrappedItemsKey: {
    nonce: '0102030405060708090a0b0c',
    cipher:
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  },
};

const DEV_URL = 'http://127.0.0.1:5173/';

describe('Vault join', () => {
  /**
   * Seed `<syncPath>/BeaverNotesSync/keyParams.json` for the run. Runs in the
   * WDIO Node process, so it must use Node fs — the Vite `@/` alias and Tauri
   * IPC are unavailable outside the WebView.
   */
  async function seedSyncFolder() {
    const syncPath = process.env.E2E_SYNC_PATH || '/tmp/beaver-e2e-sync';
    const subDir = path.join(syncPath, 'BeaverNotesSync');
    await mkdir(subDir, { recursive: true });
    await writeFile(
      path.join(subDir, 'keyParams.json'),
      JSON.stringify(KEY_PARAMS_FIXTURE)
    );
    return syncPath;
  }

  /**
   * Drive onboarding from the welcome screen to the password step with a
   * sync folder set. Welcome → customize → import (skip) → account (skip) →
   * sync (type folder, continue) → password.
   */
  async function driveToPasswordStep(syncPath) {
    await browser.url(DEV_URL);
    await browser.$('[data-testid="onboarding-welcome-continue"]').click();

    await browser.$('[data-testid="onboarding-customize-next"]').click();

    await browser.$('[data-testid="onboarding-import-skip"]').click();

    await browser.$('[data-testid="onboarding-account-skip"]').click();

    // data-testid falls through to the ui-input wrapper div; type into the
    // native input element inside it.
    const syncPathInput = await browser.$(
      '[data-testid="onboarding-sync-path"] input'
    );
    await syncPathInput.setValue(syncPath);

    await browser.$('[data-testid="onboarding-sync-next"]').click();
  }

  it('detects an existing vault and shows join mode', async () => {
    const syncPath = await seedSyncFolder();
    await driveToPasswordStep(syncPath);

    // Join-mode heading text pins that detection actually fired, and the
    // password field is the join-mode-only input.
    await expect(
      browser.$('[data-testid="vault-join-heading"]')
    ).toHaveTextContaining('Join existing vault');
    await expect(
      browser.$('[data-testid="vault-join-password"]')
    ).toBeDisplayed();
  });

  it('start fresh switches back to create mode', async () => {
    const syncPath = await seedSyncFolder();
    await driveToPasswordStep(syncPath);

    await expect(
      browser.$('[data-testid="vault-start-fresh"]')
    ).toBeDisplayed();
    await browser.$('[data-testid="vault-start-fresh"]').click();

    // The join-mode-only controls are genuinely removed in create mode, so
    // their absence proves the mode flipped.
    await expect(
      browser.$('[data-testid="vault-join-password"]')
    ).not.toBeDisplayed();
    await expect(
      browser.$('[data-testid="vault-start-fresh"]')
    ).not.toBeDisplayed();
  });
});
