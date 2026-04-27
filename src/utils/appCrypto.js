import {
  disableAppEncryptionState,
  getEncryptionState,
  lockEncryption,
  submitEncryptionPassword,
  encryptNotePayload,
  decryptNotePayload,
  clearDecryptedCaches,
  encryptionExportAppKey,
} from '@/lib/native/security.js';
import { path } from '@/lib/tauri-bridge';
import { getStoredValue } from '@/lib/native/storage';
import {
  clearSecureBlob,
  loadSecureBlob,
  persistSecureBlobInBackground,
} from '@/utils/safeStorageBlob.js';

const state = {
  enabled: false,
  loaded: false,
};
let _restoreInFlight = null;
let _appKeyRaw = null;
const BLOB_KEY = 'appPassphraseBlob';

async function refreshState() {
  const next = await getEncryptionState();
  state.enabled = !!next?.appEnabled;
  state.loaded = !!next?.appUnlocked;
  return next;
}

export function isAppEncryptionEnabled() {
  return state.enabled;
}

export function isAppKeyLoaded() {
  return state.loaded;
}

export async function exportAppKeyRaw() {
  if (!state.loaded) return null;
  if (_appKeyRaw) return _appKeyRaw;
  try {
    _appKeyRaw = await encryptionExportAppKey();
    return _appKeyRaw;
  } catch (e) {
    return null;
  }
}

export async function ensureAppKeyReadyForWrite() {
  const next = await refreshState();
  if (!next?.appEnabled) return false;
  if (next?.appUnlocked) return true;

  throw new Error(
    'App encryption key is locked. Unlock app encryption in Settings before editing notes.'
  );
}

export async function setupAppEncryption(passphrase) {
  if (!passphrase?.trim()) {
    return { ok: false, error: 'Passphrase cannot be empty.' };
  }

  try {
    const result = await submitEncryptionPassword(passphrase, 'app');
    if (!result?.ok) {
      return {
        ok: false,
        error: result?.error || 'Unable to enable app encryption.',
      };
    }
    persistSecureBlobInBackground(BLOB_KEY, passphrase, 'appCrypto');
    state.enabled = !!result?.state?.appEnabled;
    state.loaded = !!result?.state?.appUnlocked;
    return { ok: true };
  } catch (err) {
    console.error('[appCrypto] setup failed:', err);
    return { ok: false, error: String(err) };
  }
}

export async function verifyAppPassphrase(passphrase) {
  if (!passphrase?.trim()) {
    return { ok: false, error: 'Enter your password.' };
  }

  try {
    const result = await submitEncryptionPassword(
      passphrase,
      'app',
      null,
      false
    );
    if (!result?.ok) {
      return { ok: false, error: result?.error || 'Wrong password.' };
    }
    persistSecureBlobInBackground(BLOB_KEY, passphrase, 'appCrypto');
    state.enabled = !!result?.state?.appEnabled;
    state.loaded = !!result?.state?.appUnlocked;
    if (result?.state?.appUnlocked) {
      await exportAppKeyRaw();
    }
    return { ok: true };
  } catch (err) {
    console.error('[appCrypto] verify failed:', err);
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function tryRestoreAppKeyFromSafeStorage() {
  if (_restoreInFlight) return _restoreInFlight;
  _restoreInFlight = _doRestoreAppKey().finally(() => {
    _restoreInFlight = null;
  });
  return _restoreInFlight;
}

async function _doRestoreAppKey() {
  const next = await refreshState();
  if (!next?.appEnabled || next?.appUnlocked) {
    if (next?.appUnlocked) {
      await exportAppKeyRaw();
    }
    return !!next?.appUnlocked;
  }

  const passphrase = await loadSecureBlob(BLOB_KEY);
  if (!passphrase) return false;

  const result = await verifyAppPassphrase(passphrase);
  return result.ok;
}

export async function appFolderHasEncryption() {
  const next = await refreshState();
  return !!next?.appEnabled;
}

export async function disableAppEncryption(beforeKeyCleared) {
  if (typeof beforeKeyCleared === 'function') {
    await beforeKeyCleared();
  }
  await disableAppEncryptionState(true);
  await clearSecureBlob(BLOB_KEY);
  await clearDecryptedCaches();
  await refreshState();
}

export async function encryptContent(contentObj) {
  const plaintext = JSON.stringify(contentObj);
  const envelope = await encryptNotePayload(plaintext);
  return envelope;
}

export async function decryptContent(contentVal) {
  if (!contentVal) return contentVal;

  if (!isAppEncryptedContent(contentVal)) {
    return contentVal;
  }

  const plainJson = await decryptNotePayload(contentVal);
  if (plainJson === null || plainJson === undefined) return null;

  try {
    return JSON.parse(plainJson);
  } catch (e) {
    console.error(
      '[crypto] decryptContent: decrypted payload is not valid JSON',
      e
    );
    throw new Error('Decrypted note content is corrupted — JSON parse failed');
  }
}

export function isAppEncryptedContent(contentVal) {
  if (!contentVal || typeof contentVal !== 'object') return false;
  return contentVal.ae === 1 || contentVal.ae === 2;
}

export async function lockAppEncryption() {
  await lockEncryption(['app']);
  await clearDecryptedCaches();
  await refreshState();
}

void refreshState().catch(() => {});
