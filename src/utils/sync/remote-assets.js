/** Remote asset transport over HTTP: list/upload/download/delete, stored under user/assets/key with -- separator. */

import { getApiClient } from '@/lib/api/client.js';
import { uint8ArrayToBase64 } from '@/utils/helpers/index.js';
import { encryptAssetBytes } from './crypto.js';
import { useAccountStore } from '@/store/account';

let apiClient = null;
let lastServerUrl = null;

function getClient() {
  let serverUrl;
  try {
    serverUrl = useAccountStore()?.serverUrl;
  } catch {
    serverUrl = undefined;
  }
  if (apiClient && serverUrl === lastServerUrl) return apiClient;
  lastServerUrl = serverUrl;
  apiClient = getApiClient(serverUrl ? { baseUrl: serverUrl } : undefined);
  return apiClient;
}

function assertSafeSegment(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) return false;
  if (value.includes('/') || value.includes('\\') || value.includes('\0')) return false;
  if (value === '.' || value === '..' || value.includes('--')) return false;
  if (value.startsWith('.')) return false;
  return true;
}

export function encodeAssetKey(type, noteId, filename) {
  if (!assertSafeSegment(type) || !assertSafeSegment(noteId) || !assertSafeSegment(filename)) {
    throw new Error('sync: invalid asset key segment');
  }
  return `${encodeURIComponent(type)}--${encodeURIComponent(noteId)}--${encodeURIComponent(filename)}`;
}

export function decodeAssetKey(key) {
  if (typeof key !== 'string' || key.includes('/') || key.includes('\\') || key.includes('\0')) return null;
  const parts = key.split('--');
  if (parts.length < 3) return null;
  try {
    const type = decodeURIComponent(parts[0]);
    const noteId = decodeURIComponent(parts[1]);
    const filename = decodeURIComponent(parts.slice(2).join('--'));
    if (!assertSafeSegment(type) || !assertSafeSegment(noteId) || !assertSafeSegment(filename)) return null;
    return { type, noteId, filename };
  } catch {
    return null;
  }
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

async function encryptAssetItems(items) {
  const CONCURRENCY = 4;
  const out = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const slice = items.slice(i, i + CONCURRENCY);
    const encrypted = await Promise.all(
      slice.map((item) => encryptAssetBytes(item.key, item.data))
    );
    slice.forEach((item, k) => {
      out[i + k] = { key: item.key, data: uint8ArrayToBase64(encrypted[k]) };
    });
  }
  return out;
}

export async function uploadAsset(flatKey, data) {
  const client = getClient();
  // E2EE: bytes are enveloped before leaving the device; the server only
  // ever sees ciphertext (encryption at rest there is a second layer).
  const encrypted = await encryptAssetBytes(flatKey, data);
  try {
    const result = await client.put(`/assets/${encodeURIComponent(flatKey)}`, encrypted, {
      contentType: 'application/octet-stream',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(encrypted.byteLength),
      },
      timeoutMs: 60000,
    });
    return result || { status: 'uploaded' };
  } catch (err) {
    if (err?.status === 413) {
      console.warn('[sync] asset too large:', flatKey, encrypted.byteLength);
      return { status: 'skipped' };
    }
    throw err;
  }
}

export async function batchUploadAssets(items) {
  const client = getClient();
  const payload = {
    assets: await encryptAssetItems(items),
  };
  const result = await client.post('/assets/batch', payload, { timeoutMs: 120000 });
  return result || { results: [], uploaded: 0, skipped: 0 };
}

/** Seed-time batch upload: higher limits, no rate limit. */
export async function seedBatchUploadAssets(items) {
  const client = getClient();
  const payload = {
    assets: await encryptAssetItems(items),
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

export async function presignGetBatch(assetKeys) {
  const client = getClient();
  const result = await client.post('/assets/presign-get-batch', { keys: assetKeys }, { timeoutMs: 30000 });
  return result?.urls || [];
}
