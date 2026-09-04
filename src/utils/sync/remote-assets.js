/** Remote asset transport over HTTP: list/upload/download/delete, stored under user/assets/key with -- separator. */

import { getApiClient } from '@/lib/api/client.js';
import { uint8ArrayToBase64 } from '@/utils/helpers/index.js';

let apiClient = null;

function getClient() {
  if (!apiClient) {
    apiClient = getApiClient();
  }
  return apiClient;
}

/** Encode a local asset path into a flat server key: assets/abc/img.png → assets--abc--img.png */
export function encodeAssetKey(type, noteId, filename) {
  return `${type}--${noteId}--${filename}`;
}

export function decodeAssetKey(key) {
  const parts = key.split('--');
  if (parts.length < 3) return null;
  return {
    type: parts[0],
    noteId: parts[1],
    filename: parts.slice(2).join('--'),
  };
}

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

/** Seed-time batch upload: higher limits, no rate limit. */
export async function seedBatchUploadAssets(items) {
  const client = getClient();
  const payload = {
    assets: items.map((item) => ({
      key: item.key,
      data: uint8ArrayToBase64(item.data),
    })),
  };
  const result = await client.post('/assets/seed-batch', payload, { timeoutMs: 300000 });
  return result || { results: [], uploaded: 0, skipped: 0 };
}

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

export async function deleteRemoteAsset(flatKey) {
  const client = getClient();
  try {
    await client.delete(`/assets/${encodeURIComponent(flatKey)}`, { timeoutMs: 10000 });
  } catch {
    // best-effort
  }
}

export async function presignBatchUpload(assetKeys) {
  const client = getClient();
  const result = await client.post('/assets/presign-batch', { keys: assetKeys }, { timeoutMs: 30000 });
  return result?.urls || [];
}

export async function confirmSeed(assetKeys) {
  const client = getClient();
  return client.post('/assets/confirm-seed', { keys: assetKeys }, { timeoutMs: 30000 });
}

export async function presignGetBatch(assetKeys) {
  const client = getClient();
  const result = await client.post('/assets/presign-get-batch', { keys: assetKeys }, { timeoutMs: 30000 });
  return result?.urls || [];
}
