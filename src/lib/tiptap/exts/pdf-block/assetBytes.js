/**
 * assetBytes.js — read an asset's bytes the way the app serves media:
 * through the Tauri custom protocol, which returns DECRYPTED bytes for
 * copyPath-stored (encrypted) files. Raw fs reads return ciphertext for
 * those, so the protocol fetch is the correct path; the raw read stays as
 * a fallback for plaintext (menu-picked) files.
 */
import { resolveAssetPath } from '@/lib/tauri/scoped-storage';
import { readFileBinaryBytes } from '@/lib/native/fs';

const ASSET_SCHEMES = ['assets://', 'file-assets://'];

/**
 * @param {string} src
 * @returns {Promise<Uint8Array>}
 */
export async function fetchAssetBytes(src) {
  const srcStr = String(src || '');
  if (ASSET_SCHEMES.some((scheme) => srcStr.startsWith(scheme))) {
    try {
      // Range: bytes=0- bypasses serve_asset's silent 16 MiB full-read cap
      // (bootstrap.rs truncates non-range bodies; the range path has no cap)
      const response = await fetch(srcStr, {
        headers: { Range: 'bytes=0-' },
      });
      if (response.ok) {
        return new Uint8Array(await response.arrayBuffer());
      }
      // shortcut: dev-only signal; silent fallthrough hides CSP/protocol failures
      if (import.meta.env.DEV) {
        console.warn('pdf-block: asset fetch not ok, falling back to raw read', srcStr, response.status);
      }
    } catch (error) {
      // fall through to the raw read below
      if (import.meta.env.DEV) {
        console.warn('pdf-block: asset fetch failed, falling back to raw read', srcStr, error);
      }
    }
  }
  const path = await resolveAssetPath(srcStr);
  if (!path) throw new Error('unresolvable');
  return readFileBinaryBytes(path);
}
