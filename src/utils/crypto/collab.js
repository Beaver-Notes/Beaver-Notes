/**
 * Uses AES-256-GCM via Web Crypto API (native, no dependencies).
 *
 * The collaboration key is a hex-encoded 32-byte AES key fetched from
 * the Beaver-Sync backend via ML-KEM key exchange.
 */

const ALGORITHM = { name: 'AES-GCM', length: 256 };
const IV_LENGTH = 12; // 96 bits for AES-GCM

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Import a hex-encoded collaboration key as a CryptoKey.
 * @param {string} hexKey - 64-char hex string (32 bytes)
 */
export async function importCollabKey(hexKey) {
  const keyBytes = hexToBytes(hexKey);
  return crypto.subtle.importKey('raw', keyBytes, ALGORITHM, false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * @param {string} [aad] - Optional Additional Authenticated Data (e.g., noteId)
 * @returns {Promise<Uint8Array>} - IV (12 bytes) + ciphertext
 */
export async function encryptUpdate(key, plaintext, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const aadBytes = aad ? new TextEncoder().encode(aad) : undefined;
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadBytes, tagLength: 128 },
    key,
    plaintext
  );
  const result = new Uint8Array(iv.length + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), iv.length);
  return result;
}

/**
 * @param {Uint8Array} data - IV (12 bytes) + ciphertext
 * @param {string} [aad] - Optional Additional Authenticated Data (must match encryption)
 */
export async function decryptUpdate(key, data, aad) {
  const iv = data.slice(0, IV_LENGTH);
  const ciphertext = data.slice(IV_LENGTH);
  const aadBytes = aad ? new TextEncoder().encode(aad) : undefined;
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: aadBytes, tagLength: 128 },
    key,
    ciphertext
  );
  return new Uint8Array(plaintext);
}

/**
 * Check if a hex string looks like a valid collaboration key (64 hex chars).
 */
export function isValidCollabKey(hex) {
  return typeof hex === 'string' && /^[0-9a-f]{64}$/i.test(hex);
}
