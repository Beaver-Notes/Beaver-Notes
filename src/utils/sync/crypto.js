import {
  isEncryptionEnabled,
  isKeyLoaded,
  exportKeyRaw,
} from '@/utils/crypto/encryption.js';
import {
  clearSyncCryptoKey,
  gcmDecryptStr,
  gcmEncryptStr,
  initSyncCryptoKey,
  isSyncKeyLoaded,
} from './sync-crypto-codec.js';
import { ENCRYPTED_ASSET_EXT } from './constants.js';

let initPromise = null;

async function ensureSyncKey() {
  if (isSyncKeyLoaded()) return true;
  if (!isEncryptionEnabled()) return false;
  if (!isKeyLoaded()) throw new Error(
    'Encryption is enabled but the key is locked. Unlock encryption before syncing.'
  );

  if (!initPromise) {
    initPromise = (async () => {
      const raw = await exportKeyRaw();
      if (!raw) throw new Error('Failed to export app encryption key');
      await initSyncCryptoKey(raw);
    })();
  }
  await initPromise;
  return true;
}

export async function ensureSyncKeyReadyForWrite() {
  return ensureSyncKey();
}

export async function encryptJSON(obj) {
  const ready = await ensureSyncKey();
  if (!ready) return JSON.stringify(obj);
  return gcmEncryptStr(JSON.stringify(obj));
}

export async function decryptJSON(raw) {
  if (!raw) return null;
  if (typeof raw !== 'string') return raw;

  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.v === 4) {
      try {
        await ensureSyncKey();
        if (!isSyncKeyLoaded()) return null;
        const plain = await gcmDecryptStr(raw);
        return JSON.parse(plain);
      } catch (err) {
        console.error('[syncCrypto] decryptJSON failed:', err);
        return null;
      }
    }
    return parsed;
  } catch {
    return raw;
  }
}

export function clearSyncKey() {
  clearSyncCryptoKey();
  initPromise = null;
}

export function syncAssetName(localFilename) {
  return isEncryptionEnabled()
    ? `${localFilename}${ENCRYPTED_ASSET_EXT}`
    : localFilename;
}

export function localAssetName(syncFilename) {
  return syncFilename.endsWith(ENCRYPTED_ASSET_EXT)
    ? syncFilename.slice(0, -ENCRYPTED_ASSET_EXT.length)
    : syncFilename;
}
