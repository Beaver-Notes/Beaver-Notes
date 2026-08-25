import {
  isEncryptionEnabled,
} from '@/utils/crypto/encryption.js';
import {
  syncEncryptPayload,
  syncDecryptPayload,
  syncEncryptBatch,
  syncDecryptBatch,
  syncKeyReady,
} from '@/lib/native/security.js';
import { bufToBase64, base64ToBuf } from '@/utils/crypto/codec.js';
import { ENCRYPTED_ASSET_EXT } from './constants.js';

// Encryption runs entirely in Rust; the renderer never sees the items key —
// it only asks the backend to encrypt/decrypt payloads with an AAD binding.
// Sync payloads carry the Yjs update as raw bytes (base64 `data` + small `meta`),
// avoiding the old JSON number-array round-trip that cost ~950ms per multi-MB file.

export async function ensureSyncKeyReadyForWrite() {
  const ready = await syncKeyReady().catch(() => false);
  if (!ready) {
    if (!isEncryptionEnabled()) {
      throw new Error(
        'Encryption is required for sync. Enable encryption in Settings.'
      );
    }
    throw new Error(
      'Encryption key is locked. Unlock encryption before syncing.'
    );
  }
  return true;
}

export async function encryptJSON(payload, aad = '') {
  const { update, ...meta } = payload || {};
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
      console.warn('[sync][debug] decryptJSON v4/v5 failed:', msg, 'aad:', aad);
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

/** Batch-decrypt sync envelopes in one IPC call; failed items are `null`. */
export async function decryptBatch(rawEnvelopes, aads) {
  if (!rawEnvelopes.length) return [];
  const results = await syncDecryptBatch(rawEnvelopes, aads);
  const nullCount = results.filter((r) => !r).length;
  if (nullCount > 0) {
    console.warn(`[sync][debug] decryptBatch: ${nullCount}/${results.length} items returned null from Rust`);
  }
  return results.map((res) => {
    if (!res) return null;
    return { ...res.meta, update: base64ToBuf(res.update) };
  });
}

export async function encryptBatch(payloads, aads) {
  if (!payloads.length) return [];
  await ensureSyncKeyReadyForWrite();
  const metas = payloads.map((p) => {
    const { update: _update, ...meta } = p || {};
    return JSON.stringify(meta);
  });
  const dataB64s = payloads.map((p) => bufToBase64(p.update));
  return syncEncryptBatch(metas, dataB64s, aads);
}

// Sync key lifecycle is managed entirely by the Rust backend (safeStorage).
// @deprecated This is a no-op kept for backward compatibility with dynamic imports.
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
