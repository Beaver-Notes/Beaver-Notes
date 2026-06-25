import {
  ALGO_AES_GCM,
  ENVELOPE_VERSION,
  IV_LENGTH_BYTES,
  KEY_LENGTH_256,
  PBKDF2_ITERATIONS,
  SALT_LENGTH_BYTES,
} from './constants.js';
import {
  base64ToBuf,
  bufToBase64,
  bufToHex,
  deriveAesGcmKeyFromPassphrase,
  hexToBuf,
} from './codec.js';
import { AES } from 'crypto-es/lib/aes';
import { Utf8 } from 'crypto-es/lib/core';

export const LEGACY_CRYPTOJS_PREFIX = 'U2FsdGVk';
export const NOTE_CRYPTO_ERROR = 'Incorrect password';

async function _noteKey(password, saltBuf) {
  return deriveAesGcmKeyFromPassphrase(password, saltBuf, {
    iterations: PBKDF2_ITERATIONS,
  });
}

async function decryptLegacyCryptoJSNote(ciphertextB64, password) {
  const decrypted = AES.decrypt(ciphertextB64, password);
  const plaintext = decrypted.toString(Utf8);
  if (!plaintext) {
    throw new Error(NOTE_CRYPTO_ERROR);
  }
  return plaintext;
}

export async function encryptNoteWithPassword(plaintext, password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const key = await _noteKey(password, salt);
  const ct = await crypto.subtle.encrypt(
    { name: ALGO_AES_GCM, iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return JSON.stringify({
    v: ENVELOPE_VERSION,
    salt: bufToHex(salt),
    iv: bufToHex(iv),
    cipher: bufToBase64(new Uint8Array(ct)),
  });
}

export async function decryptNoteWithPassword(ciphertext, password) {
  if (typeof ciphertext !== 'string' || !ciphertext) {
    throw new Error(NOTE_CRYPTO_ERROR);
  }

  if (ciphertext.startsWith(LEGACY_CRYPTOJS_PREFIX)) {
    try {
      const plaintext = await decryptLegacyCryptoJSNote(ciphertext, password);
      return { plaintext, wasLegacy: true };
    } catch {
      throw new Error(NOTE_CRYPTO_ERROR);
    }
  }

  let parsed = null;
  try {
    parsed = JSON.parse(ciphertext);
  } catch {
    throw new Error(NOTE_CRYPTO_ERROR);
  }

  if (parsed?.v === ENVELOPE_VERSION) {
    const key = await _noteKey(password, hexToBuf(parsed.salt));
    let buf;
    try {
      buf = await crypto.subtle.decrypt(
        { name: ALGO_AES_GCM, iv: hexToBuf(parsed.iv) },
        key,
        base64ToBuf(parsed.cipher)
      );
    } catch {
      throw new Error(NOTE_CRYPTO_ERROR);
    }
    return { plaintext: new TextDecoder().decode(buf), wasLegacy: false };
  }

  throw new Error(NOTE_CRYPTO_ERROR);
}
