import {
  base64ToBuf,
  bufToBase64,
  bufToHex,
  hexToBuf,
} from '@/utils/crypto-codec.js';
import {
  ALGO_AES_GCM,
  ENVELOPE_VERSION,
  IV_LENGTH_BYTES,
} from '@/utils/crypto-constants.js';

export async function gcmEncryptStr(plaintext, key) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: ALGO_AES_GCM, iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return JSON.stringify({
    v: ENVELOPE_VERSION,
    iv: bufToHex(iv),
    enc: bufToBase64(ct),
  });
}

export async function gcmDecryptStr(jsonStr, key) {
  const { v, iv, enc } = JSON.parse(jsonStr);
  if (v !== ENVELOPE_VERSION) throw new Error('Unsupported envelope version');
  const plain = await crypto.subtle.decrypt(
    { name: ALGO_AES_GCM, iv: hexToBuf(iv) },
    key,
    base64ToBuf(enc)
  );
  return new TextDecoder().decode(plain);
}

export async function gcmEncryptBin(data, key) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const ct = await crypto.subtle.encrypt({ name: ALGO_AES_GCM, iv }, key, data);
  const merged = new Uint8Array(IV_LENGTH_BYTES + ct.byteLength);
  merged.set(iv, 0);
  merged.set(new Uint8Array(ct), IV_LENGTH_BYTES);
  return bufToBase64(merged);
}

export async function gcmDecryptBin(b64, key) {
  const merged = base64ToBuf(b64);
  const iv = merged.slice(0, IV_LENGTH_BYTES);
  const ct = merged.slice(IV_LENGTH_BYTES);
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: ALGO_AES_GCM, iv }, key, ct)
  );
}
