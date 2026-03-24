/**
 * App-wide at-rest note encryption.
 *
 * Current format: note.content = { ae: 1, iv: "<hex>", cipher: "<base64>" }.
 * Keys are derived with PBKDF2-SHA-256 and cached per session.
 *
 * Key material:
 *   {dataDir}/app-crypto/salt
 *   {dataDir}/app-crypto/keycheck
 */

import {
  base64ToBuf,
  bufToBase64,
  bufToHex,
  deriveAesGcmKeyFromPassphrase,
  hexToBuf,
} from './crypto-codec.js';
import {
  clearSecureBlob,
  loadSecureBlob,
  storeSecureBlob,
} from './safeStorageBlob.js';
import { path } from '@/lib/tauri-bridge';
import { ensureDir, pathExists, readFile, writeFile } from '@/lib/native/fs';
import {
  clearAssetPassphrase,
  setAssetPassphrase,
} from '@/lib/native/security';
import { getStoredValue } from '@/lib/native/storage';

const PBKDF2_ITERATIONS = 100_000;
const KEYCHECK_PLAINTEXT = 'BeaverNotes-app-v1';
const LS_FLAG = 'appEncryptionEnabled';
const BLOB_KEY = 'appPassphraseBlob';

let _appKey = null; // Web Crypto CryptoKey, AES-GCM 256-bit, set once per session

export function isAppEncryptionEnabled() {
  return localStorage.getItem(LS_FLAG) === 'true';
}

export function isAppKeyLoaded() {
  return _appKey !== null;
}

async function _deriveKey(passphrase, saltBuf) {
  return deriveAesGcmKeyFromPassphrase(passphrase, saltBuf, {
    iterations: PBKDF2_ITERATIONS,
  });
}

async function _gcmEncrypt(plaintext, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return { iv: bufToHex(iv), cipher: bufToBase64(ct) };
}

async function _gcmDecrypt(ivHex, cipherB64, key) {
  const buf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBuf(ivHex) },
    key,
    base64ToBuf(cipherB64)
  );
  return new TextDecoder().decode(buf);
}

async function _cryptoDir() {
  try {
    const dataDir = await getStoredValue('settings', 'dataDir', '');
    if (!dataDir) return null;
    return path.join(dataDir, 'app-crypto');
  } catch {
    return null;
  }
}

// ─── Setup (first device / first enable) ─────────────────────────────────────

export async function setupAppEncryption(passphrase) {
  if (!passphrase?.trim())
    return { ok: false, error: 'Passphrase cannot be empty.' };

  const dir = await _cryptoDir();
  if (!dir) return { ok: false, error: 'Data directory not configured.' };

  try {
    await ensureDir(dir);

    const salt = crypto.getRandomValues(new Uint8Array(32));
    const saltHex = bufToHex(salt);
    const key = await _deriveKey(passphrase, salt);

    await writeFile(path.join(dir, 'salt'), saltHex);

    const { iv, cipher } = await _gcmEncrypt(KEYCHECK_PLAINTEXT, key);
    await writeFile(
      path.join(dir, 'keycheck'),
      JSON.stringify({ v: 1, iv, cipher })
    );

    _appKey = key;
    localStorage.setItem(LS_FLAG, 'true');
    await storeSecureBlob(BLOB_KEY, passphrase, 'appCrypto');
    try {
      await setAssetPassphrase(passphrase);
    } catch {
      // non-fatal
    }
    return { ok: true };
  } catch (err) {
    console.error('[appCrypto] setup failed:', err);
    return { ok: false, error: String(err) };
  }
}

// ─── Verify ───────────────────────────────────────────────────────────────────

export async function verifyAppPassphrase(passphrase) {
  const dir = await _cryptoDir();
  if (!dir) return { ok: false, error: 'Data directory not configured.' };

  try {
    let saltHex, keycheckRaw;
    try {
      saltHex = await readFile(path.join(dir, 'salt'));
      keycheckRaw = await readFile(path.join(dir, 'keycheck'));
    } catch {
      return {
        ok: false,
        error: 'Encryption files not found. Enable app encryption first.',
      };
    }

    if (!saltHex?.trim() || !keycheckRaw?.trim()) {
      return { ok: false, error: 'Encryption files are empty or corrupted.' };
    }

    const pass = passphrase || (await loadSecureBlob(BLOB_KEY));
    if (!pass) return { ok: false, error: 'Enter your password.' };

    const key = await _deriveKey(pass, hexToBuf(saltHex.trim()));
    const kc = JSON.parse(keycheckRaw.trim());

    let plain;
    try {
      plain = await _gcmDecrypt(kc.iv, kc.cipher, key);
    } catch {
      return { ok: false, error: 'Wrong password.' };
    }

    if (plain !== KEYCHECK_PLAINTEXT)
      return { ok: false, error: 'Wrong password.' };

    _appKey = key;
    localStorage.setItem(LS_FLAG, 'true');
    if (passphrase) await storeSecureBlob(BLOB_KEY, passphrase, 'appCrypto');
    try {
      await setAssetPassphrase(pass);
    } catch {
      // non-fatal
    }
    return { ok: true };
  } catch (err) {
    console.error('[appCrypto] verify failed:', err);
    return { ok: false, error: String(err) };
  }
}

/** Try to restore the app key silently from safeStorage on startup. */
export async function tryRestoreAppKeyFromSafeStorage() {
  if (!isAppEncryptionEnabled()) return false;
  const result = await verifyAppPassphrase(); // passphrase comes from safeStorage
  return result.ok;
}

/** Returns true if the dataDir already has app-crypto salt+keycheck files. */
export async function appFolderHasEncryption() {
  const dir = await _cryptoDir();
  if (!dir) return false;
  try {
    return await pathExists(path.join(dir, 'salt'));
  } catch {
    return false;
  }
}

// ─── Disable ──────────────────────────────────────────────────────────────────

export async function disableAppEncryption() {
  if (beforeKeyCleared) {
    await beforeKeyCleared();
  }
  _appKey = null;
  localStorage.removeItem(LS_FLAG);
  await clearSecureBlob(BLOB_KEY);
  try {
    await clearAssetPassphrase();
  } catch {
    // ignore
  }
  // Note: existing ae:1-encrypted notes will be decrypted and re-saved
  // by passwd.js / the caller after calling this function (key still in
  // memory for that one pass before being nulled here — so the caller
  // should pass the key as an argument or do the re-save before calling this).
}

// ─── Note content encryption / decryption ────────────────────────────────────

/**
 * Encrypt serialised note content for at-rest storage.
 * Returns the original string unchanged if app encryption is off or key not
 * loaded (graceful degradation — no silent data loss).
 */
export async function encryptContent(contentObj) {
  if (!_appKey) return contentObj;
  const plaintext =
    typeof contentObj === 'string' ? contentObj : JSON.stringify(contentObj);
  const { iv, cipher } = await _gcmEncrypt(plaintext, _appKey);
  // Return an object so it fits the note.content schema slot without JSON-parsing issues
  return { ae: 1, iv, cipher };
}

/**
 * Decrypt a note content value from storage.
 *
 * • { ae:1, iv, cipher }  → decrypted, parsed object
 * • anything else         → returned as-is (backward compat, plain notes)
 * • ae:1 but no key       → returns null (caller must show "locked" UI)
 *
 * This function never throws; failures are returned as null.
 */
export async function decryptContent(contentVal) {
  if (!contentVal) return contentVal;

  const obj =
    typeof contentVal === 'string'
      ? (() => {
          try {
            return JSON.parse(contentVal);
          } catch {
            return null;
          }
        })()
      : contentVal;

  if (obj?.ae !== 1) return contentVal; // not app-encrypted — pass through

  if (!_appKey) return null; // encrypted but no key loaded

  try {
    const plain = await _gcmDecrypt(obj.iv, obj.cipher, _appKey);
    return JSON.parse(plain);
  } catch (err) {
    console.error('[appCrypto] decryptContent failed:', err);
    return null;
  }
}

/** Returns true if the given content value is an app-encrypted envelope. */
export function isAppEncryptedContent(contentVal) {
  if (!contentVal || typeof contentVal !== 'object') return false;
  return contentVal.ae === 1;
}
