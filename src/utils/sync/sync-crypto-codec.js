import {
  base64ToBuf,
  bufToBase64,
  bufToHex,
  hexToBuf,
} from '@/utils/crypto/codec.js';
import {
  ALGO_AES_GCM,
  ALGO_HKDF,
  HASH_SHA_256,
  IV_LENGTH_BYTES,
} from '@/utils/crypto/constants.js';

export const SYNC_ENVELOPE_VERSION = 4;

const SYNC_KEY_SALT = new Uint8Array(32).fill(0x42);
const SYNC_KEY_INFO = new TextEncoder().encode('beaver-notes-sync-key-v2');

let syncKey = null;

export async function initSyncCryptoKey(appKeyBytes) {
  if (syncKey) return syncKey;

  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    appKeyBytes,
    { name: ALGO_HKDF },
    false,
    ['deriveKey']
  );

  syncKey = await crypto.subtle.deriveKey(
    {
      name: ALGO_HKDF,
      salt: SYNC_KEY_SALT,
      info: SYNC_KEY_INFO,
      hash: HASH_SHA_256,
    },
    hkdfKey,
    { name: ALGO_AES_GCM, length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  return syncKey;
}

export function clearSyncCryptoKey() {
  syncKey = null;
}

export function isSyncKeyLoaded() {
  return syncKey !== null;
}

export async function gcmEncryptStr(plaintext) {
  if (!syncKey) throw new Error('Sync key not initialised');
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: ALGO_AES_GCM, iv },
    syncKey,
    new TextEncoder().encode(plaintext)
  );
  return JSON.stringify({
    v: SYNC_ENVELOPE_VERSION,
    iv: bufToHex(iv),
    enc: bufToBase64(ct),
  });
}

export async function gcmDecryptStr(jsonStr) {
  if (!syncKey) throw new Error('Sync key not initialised');
  const { v, iv, enc } = JSON.parse(jsonStr);
  if (v !== SYNC_ENVELOPE_VERSION) throw new Error('Unsupported envelope version');
  const plain = await crypto.subtle.decrypt(
    { name: ALGO_AES_GCM, iv: hexToBuf(iv) },
    syncKey,
    base64ToBuf(enc)
  );
  return new TextDecoder().decode(plain);
}

export async function gcmEncryptBin(data) {
  if (!syncKey) throw new Error('Sync key not initialised');
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const ct = await crypto.subtle.encrypt({ name: ALGO_AES_GCM, iv }, syncKey, data);
  const merged = new Uint8Array(IV_LENGTH_BYTES + ct.byteLength);
  merged.set(iv, 0);
  merged.set(new Uint8Array(ct), IV_LENGTH_BYTES);
  return bufToBase64(merged);
}

export async function gcmDecryptBin(b64) {
  if (!syncKey) throw new Error('Sync key not initialised');
  const merged = base64ToBuf(b64);
  const iv = merged.slice(0, IV_LENGTH_BYTES);
  const ct = merged.slice(IV_LENGTH_BYTES);
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: ALGO_AES_GCM, iv }, syncKey, ct)
  );
}
