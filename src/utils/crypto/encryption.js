import {
  disableEncryptionState,
  getEncryptionState,
  lockEncryption,
  submitEncryptionPassword,
  encryptNotePayload,
  decryptNotePayload,
  clearDecryptedCaches,
  encryptionExportAppKey,
} from '@/lib/native/security.js';
import {
  clearSecureBlob,
  loadSecureBlob,
  persistSecureBlobInBackground,
} from './safeStorageBlob.js';

const state = {
  enabled: false,
  loaded: false,
};
let _restoreInFlight = null;
let _keyRaw = null;
const BLOB_KEY = 'encryptionPassphraseBlob';

async function refreshState() {
  const next = await getEncryptionState();
  state.enabled = !!next?.enabled;
  state.loaded = !!next?.unlocked;
  return next;
}

export function isEncryptionEnabled() {
  return state.enabled;
}

export function isKeyLoaded() {
  return state.loaded;
}

export async function exportKeyRaw() {
  if (!state.loaded) return null;
  if (_keyRaw) return _keyRaw;
  try {
    _keyRaw = await encryptionExportAppKey();
    return _keyRaw;
  } catch {
    return null;
  }
}

export async function ensureKeyReadyForWrite() {
  const next = await refreshState();
  if (!next?.enabled) return false;
  if (next?.unlocked) return true;

  throw new Error(
    'Encryption key is locked. Unlock encryption in Settings before editing notes.'
  );
}

export async function setupEncryption(passphrase) {
  if (!passphrase?.trim()) {
    return { ok: false, error: 'Passphrase cannot be empty.' };
  }

  try {
    const result = await submitEncryptionPassword(passphrase);
    if (!result?.ok) {
      return {
        ok: false,
        error: result?.error || 'Unable to enable encryption.',
      };
    }
    persistSecureBlobInBackground(BLOB_KEY, passphrase, 'encryption');
    state.enabled = !!result?.state?.enabled;
    state.loaded = !!result?.state?.unlocked;
    return { ok: true };
  } catch (err) {
    console.error('[encryption] setup failed:', err);
    return { ok: false, error: String(err) };
  }
}

export async function verifyPassphrase(passphrase) {
  if (!passphrase?.trim()) {
    return { ok: false, error: 'Enter your passphrase.' };
  }

  try {
    const result = await submitEncryptionPassword(passphrase, null, false);
    if (!result?.ok) {
      return { ok: false, error: result?.error || 'Wrong passphrase.' };
    }
    persistSecureBlobInBackground(BLOB_KEY, passphrase, 'encryption');
    state.enabled = !!result?.state?.enabled;
    state.loaded = !!result?.state?.unlocked;
    if (result?.state?.unlocked) {
      await exportKeyRaw();
    }
    return { ok: true };
  } catch (err) {
    console.error('[encryption] verify failed:', err);
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function tryRestoreKeyFromSafeStorage() {
  if (_restoreInFlight) return _restoreInFlight;
  _restoreInFlight = _doRestoreKey().finally(() => {
    _restoreInFlight = null;
  });
  return _restoreInFlight;
}

async function _doRestoreKey() {
  const next = await refreshState();
  if (!next?.enabled || next?.unlocked) {
    if (next?.unlocked) {
      await exportKeyRaw();
    }
    return !!next?.unlocked;
  }

  let passphrase;
  try {
    passphrase = await loadSecureBlob(BLOB_KEY);
  } catch (err) {
    console.warn('[encryption] _doRestoreKey: loadSecureBlob failed:', err);
    return false;
  }
  if (!passphrase) return false;

  const result = await verifyPassphrase(passphrase);
  if (!result.ok) {
    console.warn(
      '[encryption] _doRestoreKey: verifyPassphrase failed:',
      result.error
    );
    return false;
  }
  return true;
}

export async function encryptionIsConfigured() {
  const next = await refreshState();
  return !!next?.enabled;
}

export async function disableEncryption(beforeKeyCleared) {
  if (typeof beforeKeyCleared === 'function') {
    await beforeKeyCleared();
  }
  await disableEncryptionState(true);
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

  if (!isEncryptedContent(contentVal)) {
    return contentVal;
  }

  const plainJson = await decryptNotePayload(contentVal);
  if (plainJson === null || plainJson === undefined) return null;

  try {
    return JSON.parse(plainJson);
  } catch (e) {
    console.error(
      '[encryption] decryptContent: decrypted payload is not valid JSON',
      e
    );
    throw new Error('Decrypted note content is corrupted — JSON parse failed');
  }
}

export function isEncryptedContent(contentVal) {
  if (!contentVal || typeof contentVal !== 'object') return false;
  return contentVal.ae === 1 || contentVal.ae === 2;
}

export async function lockEncryptionKey() {
  await lockEncryption();
  await clearDecryptedCaches();
  await refreshState();
}

// Re-exports for sync/crypto.js
export { encryptContent as encryptPayload, decryptContent as decryptPayload };

void refreshState().catch(() => {});
