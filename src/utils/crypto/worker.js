/**
 * Web Worker for off-thread cryptographic operations.
 *
 * Handles:
 *   - PBKDF2 key derivation (passphrase → AES-GCM key)
 *   - AES-GCM encrypt/decrypt (content-level, used for note payloads)
 *
 * All heavy crypto runs off the main thread so the UI stays responsive
 * even when decrypting many notes at once.
 */

import {
  ALGO_AES_GCM,
  ALGO_PBKDF2,
  BASE64_CHUNK_SIZE,
  HASH_SHA_256,
  IV_LENGTH_BYTES,
  KEY_LENGTH_256,
} from './constants.js';

function _bufToBase64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + BASE64_CHUNK_SIZE)
    );
  }
  return btoa(binary);
}

self.onmessage = async ({ data }) => {
  const { requestId, type } = data;

  try {
    if (type === 'deriveKey') {
      const { passphrase, saltHex, iterations } = data;
      const salt = Uint8Array.from(
        saltHex.match(/.{2}/g)?.map((value) => parseInt(value, 16)) || []
      );
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(passphrase),
        ALGO_PBKDF2,
        false,
        ['deriveKey']
      );
      const key = await crypto.subtle.deriveKey(
        {
          name: ALGO_PBKDF2,
          salt,
          iterations,
          hash: HASH_SHA_256,
        },
        keyMaterial,
        { name: ALGO_AES_GCM, length: KEY_LENGTH_256 },
        true,
        ['encrypt', 'decrypt']
      );
      const raw = await crypto.subtle.exportKey('raw', key);
      self.postMessage({ requestId, ok: true, raw }, [raw]);
      return;
    }

    if (type === 'encrypt') {
      const { keyRaw, plaintext } = data;
      const key = await crypto.subtle.importKey(
        'raw',
        keyRaw,
        { name: ALGO_AES_GCM, length: KEY_LENGTH_256 },
        false,
        ['encrypt']
      );
      const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
      const encoded = new TextEncoder().encode(plaintext);
      const cipherBuf = await crypto.subtle.encrypt(
        { name: ALGO_AES_GCM, iv },
        key,
        encoded
      );
      self.postMessage({
        requestId,
        ok: true,
        nonce: Array.from(iv)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(''),
        cipher: _bufToBase64(cipherBuf),
      });
      return;
    }

    if (type === 'decrypt') {
      const { keyRaw, nonceHex, cipherB64 } = data;
      const key = await crypto.subtle.importKey(
        'raw',
        keyRaw,
        { name: ALGO_AES_GCM, length: KEY_LENGTH_256 },
        false,
        ['decrypt']
      );
      const iv = Uint8Array.from(
        nonceHex.match(/.{2}/g).map((b) => parseInt(b, 16))
      );
      const cipherBytes = Uint8Array.from(atob(cipherB64), (c) =>
        c.charCodeAt(0)
      );
      const plainBuf = await crypto.subtle.decrypt(
        { name: ALGO_AES_GCM, iv },
        key,
        cipherBytes
      );
      self.postMessage({
        requestId,
        ok: true,
        plaintext: new TextDecoder().decode(plainBuf),
      });
      return;
    }

    self.postMessage({
      requestId,
      ok: false,
      error: `Unknown worker message type: ${type}`,
    });
  } catch (error) {
    self.postMessage({
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
