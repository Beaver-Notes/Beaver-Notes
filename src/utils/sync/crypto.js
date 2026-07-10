import {
  isEncryptionEnabled,
} from '@/utils/crypto/encryption.js';
import {
  syncEncryptPayload,
  syncDecryptPayload,
  syncKeyReady,
} from '@/lib/native/security.js';
import { ENCRYPTED_ASSET_EXT } from './constants.js';

// Encryption now runs entirely in Rust. The renderer never sees the items key:
// it only asks the backend to encrypt/decrypt payloads with an AAD binding.

export async function ensureSyncKeyReadyForWrite() {
  const ready = await syncKeyReady().catch(() => false);
  if (!ready) {
    if (!isEncryptionEnabled()) return false;
    throw new Error(
      'Encryption key is locked. Unlock encryption before syncing.'
    );
  }
  return true;
}

export async function encryptJSON(obj, aad = '') {
  if (!isEncryptionEnabled()) return JSON.stringify(obj);
  await ensureSyncKeyReadyForWrite();
  return syncEncryptPayload(JSON.stringify(obj), aad);
}

export class SyncCryptoError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = 'SyncCryptoError';
  }
}

export async function decryptJSON(raw, aad = '') {
  if (!raw) return null;
  if (typeof raw !== 'string') return raw;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }

  if (parsed && parsed.v === 4) {
    try {
      const plain = await syncDecryptPayload(raw, aad);
      return JSON.parse(plain);
    } catch (e) {
      const msg = String(e?.message ?? e);
      if (msg.includes('KEY_LOCKED')) {
        throw new SyncCryptoError(
          'Encryption is locked. Unlock it in Settings to sync.',
          'KEY_LOCKED'
        );
      }
      throw new SyncCryptoError(
        'The encryption password on this device does not match the one used to encrypt the sync data. Make sure both devices use the same encryption password.',
        'DECRYPT_FAILED'
      );
    }
  }

  return parsed;
}

export function clearSyncKey() {}

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
