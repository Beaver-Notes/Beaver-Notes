/**
 * Kept framework-agnostic so sync/app/note encryption paths can reuse one implementation.
 */

import { BASE64_CHUNK_SIZE } from './constants.js';

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
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + BASE64_CHUNK_SIZE);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

export function base64ToBuf(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
