import { expect } from '@wdio/globals';

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

describe('Vault join', () => {
  /** Seed `<syncPath>/BeaverNotesSync/keyParams.json` for the run. */
  async function seedSyncFolder() {
    const { writeFile, ensureDir } = await import('@/lib/native/fs');
    const path = await import('path');
    const syncPath = process.env.E2E_SYNC_PATH || '/tmp/beaver-e2e-sync';
    const subDir = path.join(syncPath, 'BeaverNotesSync');
    await ensureDir(subDir);
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
    await browser.url('/');
    await browser.$('[data-testid="onboarding-welcome-continue"]').click();

    await browser.$('[data-testid="onboarding-customize-next"]').click();

    await browser.$('[data-testid="onboarding-import-skip"]').click();

    await browser.$('[data-testid="onboarding-account-skip"]').click();

    const syncPathInput = await browser.$(
      '[data-testid="onboarding-sync-path"]'
    );
    await syncPathInput.setValue(syncPath);

    await browser.$('[data-testid="onboarding-sync-next"]').click();
  }

  it('detects an existing vault and shows join mode', async () => {
    const syncPath = await seedSyncFolder();
    await driveToPasswordStep(syncPath);

    await expect(
      browser.$('[data-testid="vault-join-heading"]')
    ).toBeDisplayed();
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

    await expect(
      browser.$('[data-testid="vault-join-heading"]')
    ).not.toBeDisplayed();
  });
});
