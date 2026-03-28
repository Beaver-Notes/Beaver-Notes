/**
 * Per-note password-based encryption primitives.
 *
 * This module handles encrypting and decrypting individual note content
 * using a user-supplied password. It is separate from app-level encryption
 * (see appCrypto.js), which uses a stored key rather than a per-note password.
 */
import { AES } from 'crypto-es/lib/aes.js';
import { Utf8 } from 'crypto-es/lib/core.js';
import {
  base64ToBuf,
  bufToBase64,
  bufToHex,
  deriveAesGcmKeyFromPassphrase,
  hexToBuf,
} from '@/utils/crypto-codec.js';

async function _noteKey(password, saltBuf) {
  return deriveAesGcmKeyFromPassphrase(password, saltBuf, {
    iterations: 100_000,
  });
}

/**
 * Encrypts a plaintext string with a password.
 * Returns a JSON string containing the v2 ciphertext envelope.
 */
export async function encryptNoteWithPassword(plaintext, password) {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await _noteKey(password, salt);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return JSON.stringify({
    v: 2,
    salt: bufToHex(salt),
    iv: bufToHex(iv),
    cipher: bufToBase64(new Uint8Array(ct)),
  });
}

/**
 * Decrypts a ciphertext string (v2 envelope or legacy AES) with a password.
 * Returns `{ plaintext: string, wasLegacy: boolean }`.
 * Throws `Error('Incorrect password')` on failure.
 */
export async function decryptNoteWithPassword(ciphertext, password) {
  // Attempt v2 JSON envelope first
  let parsed = null;
  try {
    parsed = JSON.parse(ciphertext);
  } catch {
    /* legacy format — fall through */
  }

  if (parsed?.v === 2) {
    const key = await _noteKey(password, hexToBuf(parsed.salt));
    let buf;
    try {
      buf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: hexToBuf(parsed.iv) },
        key,
        base64ToBuf(parsed.cipher)
      );
    } catch {
      throw new Error('Incorrect password');
    }
    return { plaintext: new TextDecoder().decode(buf), wasLegacy: false };
  }

  // Legacy CryptoES / AES-CBC format
  try {
    const bytes = AES.decrypt(ciphertext, password);
    const plain = bytes.toString(Utf8);
    if (!plain) throw new Error();
    return { plaintext: plain, wasLegacy: true };
  } catch {
    throw new Error('Incorrect password');
  }
}
