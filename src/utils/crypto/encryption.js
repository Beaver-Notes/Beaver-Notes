import {
  getEncryptionState,
  lockEncryption,
  submitEncryptionPassword,
  encryptNotePayload,
  decryptNotePayload,
  clearDecryptedCaches,
  reconcileSyncKeyParams,
  adoptKeyParams,
  hasRemoteKeyParams,
  generateRecoveryCode as generateRecoveryCodeNative,
  recoverWithCode,
} from '@/lib/native/security.js';
import {
  loadSecureBlob,
  persistSecureBlobInBackground,
} from './safeStorageBlob.js';

const state = {
  enabled: false,
  loaded: false,
};
let _restoreInFlight = null;
const BLOB_KEY = 'encryptionPassphraseBlob';

function generateRandomPassphrase() {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

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

export async function ensureKeyReadyForWrite() {
  const next = await refreshState();
  if (!next?.enabled) {
    const result = await setupEncryption(generateRandomPassphrase());
    if (!result.ok) {
      throw new Error(
        'Encryption setup failed: ' + (result.error || 'Unknown error')
      );
    }
    return true;
  }
  if (next?.unlocked) return true;

  throw new Error(
    'Encryption key is locked. Unlock the app before editing notes.'
  );
}

export async function setupEncryption(passphrase) {
  if (!passphrase?.trim()) {
    passphrase = generateRandomPassphrase();
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
    reconcileSyncKeyParams().catch(() => {});
    import('@/utils/sync/vault-key-params.js')
      .then((m) => m.publishCloudKeyParams())
      .catch(() => {});
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
    const result = await submitEncryptionPassword(passphrase, false);
    if (!result?.ok) {
      return { ok: false, error: result?.error || 'Wrong passphrase.' };
    }
    persistSecureBlobInBackground(BLOB_KEY, passphrase, 'encryption');
    state.enabled = !!result?.state?.enabled;
    state.loaded = !!result?.state?.unlocked;
    reconcileSyncKeyParams(passphrase).catch(() => {});
    import('@/utils/sync/vault-key-params.js')
      .then((m) => m.publishCloudKeyParams())
      .catch(() => {});
    return { ok: true };
  } catch (err) {
    const msg = err?.message || String(err);
    console.error('[encryption] verify failed:', msg);
    return { ok: false, error: msg };
  }
}

export async function adoptVaultKey(passphrase, keyParams) {
  if (!passphrase?.trim()) {
    return { ok: false, error: 'Enter the vault passphrase.' };
  }

  try {
    const result = await (keyParams == null
      ? adoptKeyParams(passphrase)
      : adoptKeyParams(passphrase, keyParams));
    if (!result?.ok) {
      return { ok: false, error: result?.error || 'Unable to join this vault.' };
    }
    state.enabled = !!result?.state?.enabled;
    state.loaded = !!result?.state?.unlocked;
    persistSecureBlobInBackground(BLOB_KEY, passphrase, 'encryption');
    return { ok: true };
  } catch (err) {
    console.error('[encryption] vault adopt failed:', err);
    return { ok: false, error: String(err) };
  }
}

export async function hasRemoteVaultKeyParams() {
  return hasRemoteKeyParams();
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

  if (next?.unlocked) return true;

  // Try to restore the key from secure storage even when getEncryptionState
  // reports enabled:false — on restart the Rust backend may not yet know
  // encryption is configured until the passphrase is re-submitted.  The
  // presence of a saved blob proves encryption was set up.
  let passphrase;
  try {
    passphrase = await loadSecureBlob(BLOB_KEY);
  } catch {
    // No blob saved or secure storage unavailable — encryption was never set up
    return false;
  }
  if (!passphrase) return false;

  const result = await verifyPassphrase(passphrase);
  if (!result.ok) {
    console.warn(
      '[encryption] _doRestoreKey: verifyPassphrase failed:',
      result.error || 'Unknown error'
    );
    return false;
  }
  return true;
}

export async function encryptionIsConfigured() {
  const next = await refreshState();
  return !!next?.enabled;
}

export async function encryptContent(contentObj) {
  const plaintext = new TextEncoder().encode(JSON.stringify(contentObj));
  const envelope = await encryptNotePayload(Array.from(plaintext));
  return envelope;
}

export async function decryptContent(contentVal) {
  if (!contentVal) return contentVal;

  if (!isAppEncryptedEnvelope(contentVal)) {
    return contentVal;
  }

  const plainBytes = await decryptNotePayload(contentVal);
  if (plainBytes === null || plainBytes === undefined) return null;

  try {
    const jsonStr = new TextDecoder().decode(new Uint8Array(plainBytes));
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error(
      '[encryption] decryptContent: decrypted payload is not valid JSON',
      e
    );
    throw new Error('Decrypted note content is corrupted — JSON parse failed');
  }
}

/**
 * True when `contentVal` is an app-key encrypted note envelope in ANY format
 * we can still decrypt (`ae:3` legacy JSON bytes, `ae:6` raw bytes). Used by
 * `decryptContent` and the import-time conversion — the runtime never holds
 * legacy envelopes.
 */
export function isAppEncryptedEnvelope(contentVal) {
  if (!contentVal || typeof contentVal !== 'object') return false;
  return contentVal.ae === 3 || contentVal.ae === 6;
}

/**
 * Runtime detection of encrypted note content. Yjs is the only content store,
 * so only the current raw-byte envelope (`ae:6`) can appear at runtime; the
 * legacy `ae:1/2/3` formats only exist inside import conversion, never here.
 */
export function isEncryptedContent(contentVal) {
  if (!contentVal || typeof contentVal !== 'object') return false;
  return contentVal.ae === 6;
}

export async function lockEncryptionKey() {
  await lockEncryption();
  await clearDecryptedCaches();
  await refreshState();
  try {
    const { clearSyncKey } = await import('@/utils/sync/crypto.js');
    clearSyncKey();
  } catch {}
}

// Re-exports for sync/crypto.js
export { encryptContent as encryptPayload, decryptContent as decryptPayload };

export async function generateRecoveryCode() {
  const result = await generateRecoveryCodeNative();
  return result?.code || null;
}

export async function recoverWithRecoveryCode(code) {
  if (!code || code.length !== 64) {
    return { ok: false, error: 'Recovery code must be 64 hex characters.' };
  }
  try {
    const result = await recoverWithCode(code);
    if (result?.ok) {
      state.enabled = !!result?.state?.enabled;
      state.loaded = !!result?.state?.unlocked;
      return { ok: true };
    }
    return { ok: false, error: result?.error || 'Recovery code is invalid.' };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

void refreshState().catch(() => {});
