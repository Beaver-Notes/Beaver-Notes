import {
  ALGO_AES_GCM,
  ENVELOPE_VERSION,
  NOTE_ENVELOPE_VERSION_ARGON2,
  IV_LENGTH_BYTES,
  SALT_LENGTH_BYTES,
} from './constants.js';
import {
  base64ToBuf,
  bufToBase64,
  bufToHex,
  hexToBuf,
  deriveAesGcmKeyFromPassphrase,
} from './codec.js';
import { decryptLegacyCryptoJSNote, deriveArgon2Key } from '@/lib/native/security.js';

export const LEGACY_CRYPTOJS_PREFIX = 'U2FsdGVk';
export const NOTE_CRYPTO_ERROR = 'Incorrect password';

// Argon2id key derivation (same KDF as the app's encryption, run in Rust).
async function _noteKeyArgon2(password, saltBuf) {
  const saltHex = bufToHex(saltBuf);
  const rawHex = await deriveArgon2Key(password, saltHex);
  const raw = hexToBuf(rawHex);
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: ALGO_AES_GCM, length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptNoteWithPassword(plaintext, password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const key = await _noteKeyArgon2(password, salt);
  const ct = await crypto.subtle.encrypt(
    { name: ALGO_AES_GCM, iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return JSON.stringify({
    v: NOTE_ENVELOPE_VERSION_ARGON2,
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

  if (parsed?.v === NOTE_ENVELOPE_VERSION_ARGON2) {
    const key = await _noteKeyArgon2(password, hexToBuf(parsed.salt));
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

  if (parsed?.v === ENVELOPE_VERSION) {
    const key = await deriveAesGcmKeyFromPassphrase(
      password,
      hexToBuf(parsed.salt)
    );
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
