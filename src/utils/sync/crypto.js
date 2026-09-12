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

// Encryption runs in Rust, renderer never sees items key: backend encrypts with AAD binding.
// Payloads carry Yjs update as base64 data plus meta, never JSON number arrays.

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
  if (typeof raw !== 'string') {
    throw new Error('sync: non-envelope payload rejected');
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('sync: non-envelope payload rejected');
  }

  if (parsed && (parsed.v === 4 || parsed.v === 5)) {
    try {
      const res = await syncDecryptPayload(raw, aad);
      return { ...res.meta, update: base64ToBuf(res.update) };
    } catch (e) {
      const msg = String(e?.message ?? e);
      if (import.meta.env.DEV) console.warn('[sync][debug] decryptJSON v4/v5 failed:', msg, 'aad:', aad);
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

  throw new Error('sync: non-envelope payload rejected');
}

/** Batch-decrypt sync envelopes in one IPC call; failed items are `null`. */
export async function decryptBatch(rawEnvelopes, aads) {
  if (!rawEnvelopes.length) return [];
  const results = await syncDecryptBatch(rawEnvelopes, aads);
  const nullCount = results.filter((r) => !r).length;
  if (nullCount > 0 && import.meta.env.DEV) {
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

export function localAssetName(syncFilename) {
  return syncFilename.endsWith(ENCRYPTED_ASSET_EXT)
    ? syncFilename.slice(0, -ENCRYPTED_ASSET_EXT.length)
    : syncFilename;
}

export function isEncryptedEnvelopeBytes(bytes) {
  if (!bytes || bytes.byteLength < 6) return false;
  const head = new TextDecoder().decode(bytes.subarray(0, 64)).trimStart();
  return /^\{\s*"v"\s*:\s*[45]/.test(head);
}

export async function encryptAssetBytes(flatKey, data) {
  await ensureSyncKeyReadyForWrite();
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const envelope = await syncEncryptPayload(
    JSON.stringify({ asset: flatKey }),
    bufToBase64(bytes),
    `asset:${flatKey}`
  );
  return new TextEncoder().encode(envelope);
}

export async function decryptAssetBytes(flatKey, bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!isEncryptedEnvelopeBytes(input)) {
    throw new Error('sync: non-envelope payload rejected');
  }
  const raw = new TextDecoder().decode(input);
  try {
    const res = await syncDecryptPayload(raw, `asset:${flatKey}`);
    return base64ToBuf(res.update);
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
