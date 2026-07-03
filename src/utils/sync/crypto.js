import {
  decryptSyncPayload,
  encryptSyncPayload,
} from '@/lib/native/security.js';
import {
  isEncryptionEnabled,
  isKeyLoaded,
} from '@/utils/crypto/encryption.js';
import { ENCRYPTED_ASSET_EXT } from './constants.js';

export async function ensureSyncKeyReadyForWrite() {
  if (!isEncryptionEnabled()) return false;
  if (isKeyLoaded()) return true;
  throw new Error(
    'Encryption is enabled but the key is locked. Unlock encryption before syncing.'
  );
}

export async function encryptJSON(obj) {
  await ensureSyncKeyReadyForWrite();
  if (!isKeyLoaded()) return JSON.stringify(obj);
  return encryptSyncPayload(JSON.stringify(obj));
}

export async function decryptJSON(raw) {
  if (!raw) return null;
  try {
    const plain = await decryptSyncPayload(raw);
    if (plain === null) return null;
    return JSON.parse(plain);
  } catch (err) {
    console.error('[syncCrypto] decryptJSON failed — key may be wrong:', err);
    throw err;
  }
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
