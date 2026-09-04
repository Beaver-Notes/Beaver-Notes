import { importCollabKey } from './collab.js';
import { bytesToHex, hexToBytes } from './hex.js';

export async function encryptComment(key, plaintext, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aadBytes = aad ? new TextEncoder().encode(aad) : undefined;
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadBytes, tagLength: 128 },
    key,
    new TextEncoder().encode(plaintext)
  );
  return {
    contentEncrypted: bytesToHex(new Uint8Array(ciphertext)),
    contentIv: bytesToHex(iv),
  };
}

export async function decryptComment(key, { contentEncrypted, contentIv }, aad) {
  const aadBytes = aad ? new TextEncoder().encode(aad) : undefined;
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBytes(contentIv), additionalData: aadBytes, tagLength: 128 },
    key,
    hexToBytes(contentEncrypted)
  );
  return new TextDecoder().decode(plaintext);
}

/** Encrypt a workspace/org name: 12-byte IV prepended to ciphertext (backend stores one opaque nameEncrypted string). */
export async function encryptName(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    new TextEncoder().encode(plaintext)
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return bytesToHex(combined);
}

export async function decryptName(key, nameEncryptedHex) {
  const combined = hexToBytes(nameEncryptedHex);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    ciphertext
  );
  return new TextDecoder().decode(plaintext);
}

export { importCollabKey };
