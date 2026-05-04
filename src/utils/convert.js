/**
 * Common conversion helpers used across import, export, and sync paths.
 */

/**
 * Decode a base64 string into a Uint8Array.
 * @param {string} base64
 * @returns {Uint8Array}
 */
export function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Remove characters that are invalid in file names across most file systems.
 * @param {string} name
 * @param {string} [fallback='Untitled']
 * @returns {string}
 */
export function sanitizeFileName(name, fallback = 'Untitled') {
  const sanitized = String(name || '')
    .replace(/[<>:"\\|?*\u0000-\u001F]/g, '-')
    .trim();
  return sanitized || fallback;
}
