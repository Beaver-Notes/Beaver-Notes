import * as CryptoJS from 'crypto-es';
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
import { getSyncPath } from './syncPath.js';
import { backend, path } from '@/lib/tauri-bridge';
const { AES: _CBC, enc: _enc, algo: _algo, PBKDF2: _PBKDF2 } = CryptoJS;

const PBKDF2_ITERATIONS = 100_000;
const KEYCHECK_PLAINTEXT = 'BeaverNotes-sync-v1';
const LS_ENCRYPTION_FLAG = 'syncEncryptionEnabled';
const FOLDER_ENCRYPTION_CACHE_MS = 3000;
const SYNC_BLOB_KEY = 'syncPassphraseBlob';
let _key = null;
let _legacyCBCKey = null;
let _folderEncryptionCache = {
  syncPath: '',
  checkedAt: 0,
  hasCrypto: false,
};

async function _deriveKey(passphrase, saltBuf) {
  return deriveAesGcmKeyFromPassphrase(passphrase, saltBuf, {
    iterations: PBKDF2_ITERATIONS,
  });
}
async function _gcmEncryptStr(plaintext, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return JSON.stringify({ v: 2, iv: bufToHex(iv), enc: bufToBase64(ct) });
}
async function _gcmDecryptStr(jsonStr, key) {
  const { v, iv, enc } = JSON.parse(jsonStr);
  if (v !== 2) throw new Error('Unsupported envelope version');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBuf(iv) },
    key,
    base64ToBuf(enc)
  );
  return new TextDecoder().decode(plain);
}
async function _gcmEncryptBin(data, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  const merged = new Uint8Array(12 + ct.byteLength);
  merged.set(iv, 0);
  merged.set(new Uint8Array(ct), 12);
  return bufToBase64(merged);
}
async function _gcmDecryptBin(b64, key) {
  const merged = base64ToBuf(b64);
  const iv = merged.slice(0, 12);
  const ct = merged.slice(12);
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  );
}

export function isSyncEncryptionEnabled() {
  return localStorage.getItem(LS_ENCRYPTION_FLAG) === 'true';
}

function _setSyncEncryptionEnabled(enabled) {
  if (enabled) localStorage.setItem(LS_ENCRYPTION_FLAG, 'true');
  else localStorage.removeItem(LS_ENCRYPTION_FLAG);
}

export function isSyncKeyLoaded() {
  return _key !== null;
}

export async function setupSyncEncryption(passphrase) {
  if (!passphrase?.trim())
    return { ok: false, error: 'Passphrase cannot be empty.' };

  const syncPath = await getSyncPath();
  if (!syncPath) return { ok: false, error: 'Choose a sync folder first.' };

  try {
    const cryptoDir = _cryptoDir(syncPath);
    await backend.invoke('fs:ensureDir', cryptoDir);

    const salt = crypto.getRandomValues(new Uint8Array(32));
    const saltHex = bufToHex(salt);
    const key = await _deriveKey(passphrase, salt);
    await backend.invoke('fs:writeFile', {
      path: path.join(cryptoDir, 'salt'),
      data: saltHex,
    });
    const keycheck = await _gcmEncryptStr(KEYCHECK_PLAINTEXT, key);
    await backend.invoke('fs:writeFile', {
      path: path.join(cryptoDir, 'keycheck'),
      data: keycheck,
    });

    _key = key;
    _setSyncEncryptionEnabled(true);
    await storeSecureBlob(SYNC_BLOB_KEY, passphrase, 'syncCrypto');

    return { ok: true };
  } catch (err) {
    console.error('[syncCrypto] setup failed:', err);
    return { ok: false, error: String(err) };
  }
}

export async function verifySyncPassphrase(passphrase) {
  const syncPath = await getSyncPath();
  if (!syncPath) return { ok: false, error: 'No sync folder configured.' };

  try {
    const cryptoDir = _cryptoDir(syncPath);

    let saltHex, keycheck;
    try {
      saltHex = await backend.invoke(
        'fs:readFile',
        path.join(cryptoDir, 'salt')
      );
      keycheck = await backend.invoke(
        'fs:readFile',
        path.join(cryptoDir, 'keycheck')
      );
    } catch {
      return {
        ok: false,
        error:
          'Encryption files not found. Set up encryption on the first device first.',
      };
    }

    if (!saltHex?.trim() || !keycheck?.trim()) {
      return { ok: false, error: 'Encryption files are empty or corrupted.' };
    }

    const pass = passphrase || (await loadSecureBlob(SYNC_BLOB_KEY));
    if (!pass) return { ok: false, error: 'Enter your sync passphrase.' };

    const saltBuf = hexToBuf(saltHex.trim());
    const key = await _deriveKey(pass, saltBuf);
    const kc = keycheck.trim();
    let verified = false;
    let isLegacyKeycheck = false;

    if (kc.startsWith('{')) {
      try {
        const plain = await _gcmDecryptStr(kc, key);
        verified = plain === KEYCHECK_PLAINTEXT;
      } catch {
        return { ok: false, error: 'Wrong passphrase.' };
      }
    } else {
      const cbcKey = _PBKDF2(pass, _enc.Hex.parse(saltHex.trim()), {
        keySize: 8,
        iterations: PBKDF2_ITERATIONS,
        hasher: _algo.SHA256,
      });
      try {
        const plain = _CBC.decrypt(kc, cbcKey).toString(_enc.Utf8);
        verified = plain === KEYCHECK_PLAINTEXT;
        if (verified) {
          _legacyCBCKey = cbcKey;
          isLegacyKeycheck = true;
        }
      } catch {
        return { ok: false, error: 'Wrong passphrase.' };
      }
    }

    if (!verified) return { ok: false, error: 'Wrong passphrase.' };

    _key = key;
    _setSyncEncryptionEnabled(true);
    if (passphrase)
      await storeSecureBlob(SYNC_BLOB_KEY, passphrase, 'syncCrypto');
    if (isLegacyKeycheck) {
      try {
        const newKeycheck = await _gcmEncryptStr(KEYCHECK_PLAINTEXT, key);
        await backend.invoke('fs:writeFile', {
          path: path.join(cryptoDir, 'keycheck'),
          data: newKeycheck,
        });
      } catch (upgradeErr) {
        console.warn(
          '[syncCrypto] keycheck upgrade failed (non-fatal):',
          upgradeErr
        );
      }
    }

    return { ok: true };
  } catch (err) {
    console.error('[syncCrypto] verify failed:', err);
    return { ok: false, error: String(err) };
  }
}

export async function tryRestoreKeyFromSafeStorage() {
  const folderEncrypted = await syncFolderHasEncryption();
  if (folderEncrypted) _setSyncEncryptionEnabled(true);

  const shouldAttemptRestore = isSyncEncryptionEnabled() || folderEncrypted;
  if (!shouldAttemptRestore) return false;
  const result = await verifySyncPassphrase();
  return result.ok;
}

export async function ensureSyncKeyReadyForWrite() {
  const folderEncrypted = await syncFolderHasEncryption();
  if (folderEncrypted) _setSyncEncryptionEnabled(true);

  const encryptionRequired = isSyncEncryptionEnabled() || folderEncrypted;
  if (!encryptionRequired) return false;
  if (_key) return true;

  const restored = await tryRestoreKeyFromSafeStorage();
  if (!restored || !_key) {
    throw new Error(
      'Sync encryption is enabled but the key is locked. Unlock sync encryption first.'
    );
  }
  return true;
}
export async function disableSyncEncryption(removeCryptoFiles = false) {
  _key = null;
  _legacyCBCKey = null;
  _setSyncEncryptionEnabled(false);
  await clearSecureBlob(SYNC_BLOB_KEY);
  _clearFolderEncryptionCache();

  if (removeCryptoFiles) {
    const syncPath = await getSyncPath();
    if (syncPath) {
      try {
        await backend.invoke('fs:remove', _cryptoDir(syncPath));
        _clearFolderEncryptionCache();
      } catch (err) {
        console.warn('[syncCrypto] could not remove crypto dir:', err);
      }
    }
  }
}

export async function syncFolderHasEncryption(options = {}) {
  const { force = false } = options;
  const syncPath = await getSyncPath();
  if (!syncPath) return false;
  try {
    const now = Date.now();
    if (
      !force &&
      _folderEncryptionCache.syncPath === syncPath &&
      now - _folderEncryptionCache.checkedAt < FOLDER_ENCRYPTION_CACHE_MS
    ) {
      if (_folderEncryptionCache.hasCrypto) _setSyncEncryptionEnabled(true);
      return _folderEncryptionCache.hasCrypto;
    }

    const hasCrypto = await backend.invoke(
      'fs:pathExists',
      path.join(_cryptoDir(syncPath), 'salt')
    );
    _folderEncryptionCache = {
      syncPath,
      checkedAt: now,
      hasCrypto,
    };
    if (hasCrypto) _setSyncEncryptionEnabled(true);
    return hasCrypto;
  } catch {
    return false;
  }
}

export async function encryptJSON(obj) {
  await ensureSyncKeyReadyForWrite();
  if (!_key) return JSON.stringify(obj);
  return _gcmEncryptStr(JSON.stringify(obj), _key);
}

export async function decryptJSON(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);

    if (parsed?.v === 2) {
      if (!_key) {
        console.warn(
          '[syncCrypto] Encrypted commit (v2) received but no key is loaded — skipping'
        );
        return null;
      }
      return JSON.parse(await _gcmDecryptStr(raw, _key));
    }

    if (parsed?.v === 1) {
      if (!_legacyCBCKey && !_key) {
        console.warn(
          '[syncCrypto] Encrypted commit (v1) received but no key is loaded — skipping'
        );
        return null;
      }
      if (_legacyCBCKey) {
        const plain = _CBC
          .decrypt(parsed.enc, _legacyCBCKey)
          .toString(_enc.Utf8);
        return JSON.parse(plain);
      }
      console.warn(
        '[syncCrypto] v1 commit found but no CBC key cached — skipping'
      );
      return null;
    }

    return parsed; // plain JSON (no encryption)
  } catch (err) {
    console.warn('[syncCrypto] decryptJSON error:', err);
    return null;
  }
}

export function syncAssetName(localFilename) {
  return _key ? `${localFilename}.enc` : localFilename;
}

export function localAssetName(syncFilename) {
  return syncFilename.endsWith('.enc')
    ? syncFilename.slice(0, -4)
    : syncFilename;
}

export async function readAndEncryptAsset(localFilePath) {
  const base64 = await backend.invoke('fs:readData', localFilePath);
  if (!_key) return base64;
  const raw = new TextEncoder().encode(base64);
  return _gcmEncryptBin(raw, _key);
}
export async function decryptAndWriteAsset(
  cipherOrBase64,
  destPath,
  options = {}
) {
  const { skipAssetEncryption = false } = options;
  let base64 = cipherOrBase64;

  if (_key) {
    try {
      const decrypted = await _gcmDecryptBin(cipherOrBase64, _key);
      base64 = new TextDecoder().decode(decrypted);
    } catch {
      if (_legacyCBCKey) {
        try {
          base64 = _CBC
            .decrypt(cipherOrBase64, _legacyCBCKey)
            .toString(_enc.Utf8);
        } catch {
          base64 = null;
        }
      } else {
        base64 = cipherOrBase64;
      }
      if (!base64 || !base64.trim()) {
        console.error(
          `[syncCrypto] decryptAndWriteAsset: decryption produced empty output for "${destPath}". ` +
            'The file in the sync folder may be corrupted or encrypted with a different key. Skipping write.'
        );
        throw new Error(`Cannot decrypt asset: ${destPath}`);
      }

      console.warn(
        `[syncCrypto] decryptAndWriteAsset: fell back to legacy CBC decryption for "${destPath}". ` +
          'This asset predates encryption upgrades and will re-encrypt on the next sync.'
      );
    }
  }

  if (!base64) {
    throw new Error(
      `[syncCrypto] No decryptable content for asset: ${destPath}`
    );
  }

  await backend.invoke('fs:writeFile', {
    path: destPath,
    data: base64ToBuf(base64),
    skipAssetEncryption,
  });
}

function _cryptoDir(syncPath) {
  return path.join(syncPath, 'BeaverNotesSync', 'crypto');
}

function _clearFolderEncryptionCache() {
  _folderEncryptionCache = {
    syncPath: '',
    checkedAt: 0,
    hasCrypto: false,
  };
}
