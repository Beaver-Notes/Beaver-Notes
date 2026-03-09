/**
 * Shared renderer crypto/encoding helpers.
 * Kept framework-agnostic so sync/app/note encryption paths can reuse one implementation.
 */

export function hexToBuf(hex) {
  const clean = (hex || '').trim();
  const b = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    b[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return b;
}

export function bufToHex(buf) {
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function bufToBase64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

export function base64ToBuf(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function deriveAesGcmKeyFromPassphrase(
  passphrase,
  saltBuf,
  options = {}
) {
  const {
    iterations = 100_000,
    usages = ['encrypt', 'decrypt'],
    extractable = false,
  } = options;
  const km = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuf,
      iterations,
      hash: 'SHA-256',
    },
    km,
    { name: 'AES-GCM', length: 256 },
    extractable,
    usages
  );
}
