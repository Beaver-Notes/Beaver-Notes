import { getSyncPath } from '@/utils/sync/path.js';
import {
  isSyncEncryptionEnabled,
  isSyncKeyLoaded,
  syncFolderHasEncryption,
  tryRestoreKeyFromSafeStorage,
  verifySyncPassphrase,
} from '@/utils/sync/crypto.js';
import {
  appFolderHasEncryption,
  isAppEncryptionEnabled,
  isAppKeyLoaded,
  setupAppEncryption,
  tryRestoreAppKeyFromSafeStorage,
  verifyAppPassphrase,
} from '@/utils/appCrypto.js';

// Central point for handling both app and sync encryption with a single password.
// Callers get explicit results they can surface to users if something goes wrong.

export async function restoreAllEncryptionKeysFromSafeStorage() {
  // Ensure sync path is hydrated before querying sync encryption state.
  await getSyncPath().catch(() => null);

  const [app, sync] = await Promise.allSettled([
    tryRestoreAppKeyFromSafeStorage(),
    tryRestoreKeyFromSafeStorage(),
  ]);

  return {
    appRestored: app.status === 'fulfilled' ? !!app.value : false,
    syncRestored: sync.status === 'fulfilled' ? !!sync.value : false,
  };
}

export async function unlockEnabledEncryptionScopes(password) {
  const result = {
    ok: true,
    app: { required: false, unlocked: false, error: null },
    sync: { required: false, unlocked: false, error: null },
  };

  // App encryption is enabled if there is an on-disk manifest.
  try {
    const appRequired = await appFolderHasEncryption();
    result.app.required = !!appRequired;
  } catch (err) {
    result.ok = false;
    result.app.error = err?.message || String(err);
  }

  // Sync encryption is enabled either via setting toggle or existing sync folder manifest.
  try {
    const folderEncrypted = await syncFolderHasEncryption();
    result.sync.required = !!folderEncrypted || !!isSyncEncryptionEnabled();
  } catch (err) {
    result.ok = false;
    result.sync.error = err?.message || String(err);
  }

  if (result.app.required) {
    try {
      const unlock = await verifyAppPassphrase(password);
      result.app.unlocked = !!unlock?.ok;
      if (!unlock?.ok) {
        result.ok = false;
        result.app.error = unlock?.error || 'Wrong password.';
      }
    } catch (err) {
      result.ok = false;
      result.app.error = err?.message || String(err);
    }
  } else {
    result.app.unlocked = !isAppEncryptionEnabled() || isAppKeyLoaded();
  }

  if (result.sync.required) {
    try {
      const unlock = await verifySyncPassphrase(password);
      result.sync.unlocked = !!unlock?.ok;
      if (!unlock?.ok) {
        result.ok = false;
        result.sync.error = unlock?.error || 'Wrong password.';
      }
    } catch (err) {
      result.ok = false;
      result.sync.error = err?.message || String(err);
    }
  } else {
    result.sync.unlocked = !isSyncEncryptionEnabled() || isSyncKeyLoaded();
  }

  return result;
}

export async function setupAppEncryptionScope(password) {
  if (!password?.trim()) return { ok: false, error: 'Enter your password.' };
  return setupAppEncryption(password);
}
