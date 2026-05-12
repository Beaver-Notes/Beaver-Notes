import { readLocalAssetData } from './sync-crypto-storage.js';
import { base64ToBuf } from '@/utils/crypto-codec.js';
import { writeFile as writeSyncFile } from '@/lib/native/fs.js';
import {
  decryptSyncAssetBase64,
  decryptSyncPayload,
  encryptSyncAssetBase64,
  encryptSyncPayload,
} from '@/lib/native/security.js';
import {
  isEncryptionEnabled,
  isKeyLoaded,
  encryptPayload,
  decryptPayload,
} from '@/utils/encryption.js';
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

export async function readAndEncryptAsset(localFilePath) {
  const base64 = await readLocalAssetData(localFilePath, {
    skipDecryption: true,
  });
  return base64;
}

export async function decryptAndWriteAsset(
  cipherOrBase64,
  destPath,
  options = {}
) {
  const { skipAssetEncryption = false } = options;
  let base64 = cipherOrBase64;

  if (isKeyLoaded()) {
    base64 = await decryptSyncAssetBase64(cipherOrBase64);
  }

  if (base64 === null || !base64) {
    throw new Error(
      `[syncCrypto] No decryptable content for asset: ${destPath}`
    );
  }

  await writeSyncFile(destPath, base64ToBuf(base64), { skipAssetEncryption });
}
