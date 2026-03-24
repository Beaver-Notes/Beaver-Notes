import * as CryptoJS from 'crypto-es';
import {
  base64ToBuf,
  bufToBase64,
  bufToHex,
  hexToBuf,
} from '@/utils/crypto-codec.js';

const { AES: _CBC, enc: _enc } = CryptoJS;

export async function gcmEncryptStr(plaintext, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return JSON.stringify({ v: 2, iv: bufToHex(iv), enc: bufToBase64(ct) });
}

export async function gcmDecryptStr(jsonStr, key) {
  const { v, iv, enc } = JSON.parse(jsonStr);
  if (v !== 2) throw new Error('Unsupported envelope version');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBuf(iv) },
    key,
    base64ToBuf(enc)
  );
  return new TextDecoder().decode(plain);
}

export async function gcmEncryptBin(data, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  const merged = new Uint8Array(12 + ct.byteLength);
  merged.set(iv, 0);
  merged.set(new Uint8Array(ct), 12);
  return bufToBase64(merged);
}

export async function gcmDecryptBin(b64, key) {
  const merged = base64ToBuf(b64);
  const iv = merged.slice(0, 12);
  const ct = merged.slice(12);
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  );
}

export function decryptLegacyCiphertext(ciphertext, legacyCBCKey) {
  return _CBC.decrypt(ciphertext, legacyCBCKey).toString(_enc.Utf8);
}
