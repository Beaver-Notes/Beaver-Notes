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
    // Fetch server key params FIRST so reconcile adopts the vault owner's keys
    // instead of overwriting the server with this device's own.
    const { fetchCloudKeyParams } = await import('@/utils/sync/vault-key-params.js');
    await fetchCloudKeyParams().catch(() => null);
    // Adopt server keys now, else writes use fresh local key until first reconcile.
    await reconcileSyncKeyParams(passphrase).catch(() => {});
    // NEVER auto-publish key params here.  If fetchCloudKeyParams returned null
    // (workspace not loaded, network glitch, 404), publishCloudKeyParams would
    // overwrite the vault owner's keys with this device's freshly-generated key.
    // Key params are published only by seedCloudOnce and adoptVaultKey.
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
    // Same sequence as setupEncryption: fetch server params, adopt with the
    // passphrase, never auto-publish (see setupEncryption).
    const { fetchCloudKeyParams } = await import('@/utils/sync/vault-key-params.js');
    await fetchCloudKeyParams().catch(() => null);
    await reconcileSyncKeyParams(passphrase).catch(() => {});
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
    // Discard pre-adoption pending writes: encrypted with old key, never flush.
    try {
      const { clearPendingWrites } = await import('@/utils/sync/pending-writes.js');
      clearPendingWrites();
    } catch {}
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

  // State may report disabled before passphrase resubmitted: saved blob proves setup, try restore.
  let passphrase;
  try {
    passphrase = await loadSecureBlob(BLOB_KEY);
  } catch {
    // No blob or storage unavailable: encryption never set up.
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
    throw new Error('Decrypted note content is corrupted: JSON parse failed');
  }
}

/** True when contentVal is decryptable app-key envelope (ae:3 legacy, ae:6 raw). Runtime never holds legacy. */
export function isAppEncryptedEnvelope(contentVal) {
  if (!contentVal || typeof contentVal !== 'object') return false;
  return contentVal.ae === 3 || contentVal.ae === 6;
}

/**
 * Runtime detection of encrypted note content. Only the raw-byte envelope
 * (`ae:6`) appears at runtime; legacy `ae:1/2/3` exist only in import conversion.
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
