/**
 * dataUrl.js — decode a data: URL into bytes. Pure, so specs use it unmocked.
 *
 * @param {string} src
 * @returns {Uint8Array | null} bytes, or null when src is not a base64 data URL
 */
export function decodeDataUrl(src) {
  const match = /^data:[^;,]+;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(src));
  if (!match) return null;
  const binary = atob(match[1].replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
