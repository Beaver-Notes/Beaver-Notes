import {
  isEncryptionEnabled,
} from '@/utils/crypto/encryption.js';
import {
  syncEncryptPayload,
  syncDecryptPayload,
  syncKeyReady,
} from '@/lib/native/security.js';
import { bufToBase64, base64ToBuf } from '@/utils/crypto/codec.js';
import { ENCRYPTED_ASSET_EXT } from './constants.js';

// Encryption now runs entirely in Rust. The renderer never sees the items key:
// it only asks the backend to encrypt/decrypt payloads with an AAD binding.
//
// Sync payloads carry the Yjs update as raw bytes: the JS layer sends the update
// as base64 (`data`) alongside a small `meta` object (`{device, ts, seq,
// noteId}`), and the backend encrypts the raw bytes directly. This avoids the
// old `update: Array.from(bytes)` + JSON.stringify/serde round-trip on a huge
// number array, which cost ~950ms per multi-MB sync file.

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

export async function encryptJSON(payload, aad = '') {
  const { update, ...meta } = payload || {};
  if (!isEncryptionEnabled()) {
    return JSON.stringify({ ...meta, update: bufToBase64(update) });
  }
  await ensureSyncKeyReadyForWrite();
  return syncEncryptPayload(JSON.stringify(meta), bufToBase64(update), aad);
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

  if (parsed && (parsed.v === 4 || parsed.v === 5)) {
    try {
      const res = await syncDecryptPayload(raw, aad);
      return { ...res.meta, update: base64ToBuf(res.update) };
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

  if (parsed && typeof parsed.update === 'string') {
    return { ...parsed, update: base64ToBuf(parsed.update) };
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
