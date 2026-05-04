import {
  ALGO_AES_GCM,
  ENVELOPE_VERSION,
  IV_LENGTH_BYTES,
  KEY_LENGTH_256,
  PBKDF2_ITERATIONS,
  SALT_LENGTH_BYTES,
} from '@/utils/crypto-constants.js';
import {
  base64ToBuf,
  bufToBase64,
  bufToHex,
  deriveAesGcmKeyFromPassphrase,
  hexToBuf,
} from '@/utils/crypto-codec.js';

async function _noteKey(password, saltBuf) {
  return deriveAesGcmKeyFromPassphrase(password, saltBuf, {
    iterations: PBKDF2_ITERATIONS,
  });
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
  let parsed = null;
  try {
    parsed = JSON.parse(ciphertext);
  } catch {
    throw new Error('Incorrect password');
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
      throw new Error('Incorrect password');
    }
    return { plaintext: new TextDecoder().decode(buf), wasLegacy: false };
  }

  throw new Error('Incorrect password');
}
