/**
 * Remote asset sync — mirrors the folder asset protocol over HTTP.
 *
 * listAssets()   → GET /assets          (returns list of keys)
 * uploadAsset()  → PUT /assets/:key     (raw binary upload)
 * downloadAsset()→ GET /assets/:key     (returns presigned URL, then fetch)
 * deleteAsset()  → DELETE /assets/:key
 *
 * The server stores assets under {userId}/assets/{key}.
 * Keys use '--' as separator: {type}--{noteId}--{filename}
 */

import { getApiClient } from '@/lib/api/client.js';

const textEncoder = new TextEncoder();

function uint8ArrayToBase64(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

let apiClient = null;

function getClient() {
  if (!apiClient) {
    apiClient = getApiClient();
  }
  return apiClient;
}

/**
 * Encode a local asset path into a flat server key.
 * assets/abc123/image.png → assets--abc123--image.png
 */
export function encodeAssetKey(type, noteId, filename) {
  return `${type}--${noteId}--${filename}`;
}

/**
 * Decode a flat server key back into { type, noteId, filename }.
 */
export function decodeAssetKey(key) {
  const parts = key.split('--');
  if (parts.length < 3) return null;
  return {
    type: parts[0],
    noteId: parts[1],
    filename: parts.slice(2).join('--'),
  };
}

/**
 * List all asset keys on the server.
 * @returns {Promise<string[]>} flat keys like "assets--abc--img.png"
 */
export async function listRemoteAssets() {
  const client = getClient();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await client.get('/assets', { timeoutMs: 20000 });
      return result?.keys || [];
    } catch (err) {
      if (err?.status === 404) return [];
      if (attempt < 2) {
        const waitMs = 2000 * (attempt + 1);
        console.warn(`[sync] listRemoteAssets failed (attempt ${attempt + 1}), retrying in ${waitMs}ms:`, err?.message || err?.status);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      console.warn('[sync] listRemoteAssets failed after 3 attempts:', err?.message);
      return [];
    }
  }
  return [];
}

/**
 * Upload a local file to the server as an asset.
 * @param {string} flatKey - encoded key like "assets--abc--img.png"
 * @param {Uint8Array|Buffer} data - raw file bytes
 * @returns {Promise<{status: string, sizeBytes?: number}>}
 */
export async function uploadAsset(flatKey, data) {
  const client = getClient();
  try {
    const result = await client.put(`/assets/${encodeURIComponent(flatKey)}`, data, {
      contentType: 'application/octet-stream',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(data.byteLength ?? data.length),
      },
      timeoutMs: 60000,
    });
    return result || { status: 'uploaded' };
  } catch (err) {
    if (err?.status === 413) {
      console.warn('[sync] asset too large:', flatKey, data.byteLength ?? data.length);
      return { status: 'skipped' };
    }
    throw err;
  }
}

/**
 * Batch-upload multiple assets in a single request.
 * @param {Array<{key: string, data: Uint8Array}>} items
 * @returns {Promise<{results: Array, uploaded: number, skipped: number}>}
 */
export async function batchUploadAssets(items) {
  const client = getClient();
  const payload = {
    assets: items.map((item) => ({
      key: item.key,
      data: uint8ArrayToBase64(item.data),
    })),
  };
  const result = await client.post('/assets/batch', payload, { timeoutMs: 120000 });
  return result || { results: [], uploaded: 0, skipped: 0 };
}

/**
 * Download an asset from the server.
 * @param {string} flatKey - encoded key
 * @returns {Promise<Uint8Array|null>} raw file bytes, or null if not found
 */
export async function downloadAsset(flatKey) {
  const client = getClient();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await client.getBinary(
        `/assets/${encodeURIComponent(flatKey)}/content`,
        { timeoutMs: 30000 }
      );
      if (!data || data.byteLength === 0) return null;
      return data instanceof Uint8Array ? data : new Uint8Array(data);
    } catch (err) {
      if (err?.status === 404) return null;
      if (err?.status === 429 && attempt < 2) {
        const waitMs = 2000 * (attempt + 1);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      if (attempt === 0) {
        console.warn('[sync] downloadAsset failed:', flatKey, err?.message || err?.status);
      }
      return null;
    }
  }
  return null;
}

/**
 * Delete an asset from the server.
 * @param {string} flatKey
 */
export async function deleteRemoteAsset(flatKey) {
  const client = getClient();
  try {
    await client.delete(`/assets/${encodeURIComponent(flatKey)}`, { timeoutMs: 10000 });
  } catch {
    // best-effort
  }
}

/**
 * Get presigned PUT URLs for batch direct-to-R2 upload.
 * @param {string[]} assetKeys - flat keys like "assets--abc--img.png"
 * @returns {Promise<Array<{assetKey: string, url: string}>>}
 */
export async function presignBatchUpload(assetKeys) {
  const client = getClient();
  const result = await client.post('/assets/presign-batch', { keys: assetKeys }, { timeoutMs: 30000 });
  return result?.urls || [];
}

/**
 * Confirm that assets were uploaded directly to R2.
 * @param {string[]} assetKeys - flat keys that were uploaded
 * @returns {Promise<{verified: number, total: number, sizeBytes: number}>}
 */
export async function confirmSeed(assetKeys) {
  const client = getClient();
  return client.post('/assets/confirm-seed', { keys: assetKeys }, { timeoutMs: 30000 });
}
