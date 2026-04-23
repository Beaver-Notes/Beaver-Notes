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

export async function decryptNoteWithPassword(ciphertext, password) {
  let parsed = null;
  try {
    parsed = JSON.parse(ciphertext);
  } catch {
    throw new Error('Incorrect password');
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

  throw new Error('Incorrect password');
}
