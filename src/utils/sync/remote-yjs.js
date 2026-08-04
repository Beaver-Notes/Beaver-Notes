/**
 * Remote Yjs sync transport — mirrors the folder sync protocol over HTTP.
 *
 * pushUpdates() → POST /yjs/push  (encrypted Yjs updates as base64)
 * pullUpdates()  → POST /yjs/pull  (returns updates since cursor)
 * deleteRemoteUpdates() → DELETE /yjs/updates (after compaction)
 *
 * The server stores opaque blobs keyed by the same filename convention
 * used in the local sync folder: {noteId}~~{deviceId}~~{ts}~~{seq}.yjs.json
 */

import { getApiClient } from '@/lib/api/client.js';
import { getSyncDeviceId } from './sync-repository.js';

let apiClient = null;

function getClient() {
  if (!apiClient) {
    apiClient = getApiClient();
  }
  return apiClient;
}

/**
 * Push local Yjs updates to the remote server.
 * @param {Array<{key: string, data: string}>} updates - base64-encoded encrypted payloads
 * @returns {Promise<{stored: number, skipped: number, sizeBytes: number}>}
 */
export async function pushUpdates(updates) {
  if (!updates || updates.length === 0) {
    return { stored: 0, skipped: 0, sizeBytes: 0 };
  }

  const client = getClient();
  const deviceId = getSyncDeviceId();

  const result = await client.post('/yjs/push', { updates }, {
    headers: {
      'X-Device-Id': deviceId,
      'X-Device-label': getDeviceLabel(),
    },
    timeoutMs: 30000,
  });

  return result || { stored: 0, skipped: 0, sizeBytes: 0 };
}

/**
 * Pull remote updates since the given cursor watermark.
 * @param {Object} cursors - { [deviceId]: { ts: number, seq: number } }
 * @returns {Promise<Array<{key: string, data: string}>>}
 */
export async function pullUpdates(cursors) {
  const client = getClient();

  const validCursors = {};
  for (const [key, val] of Object.entries(cursors || {})) {
    if (val && typeof val === 'object' && typeof val.ts === 'number' && typeof val.seq === 'number') {
      validCursors[key] = val;
    }
  }

  const result = await client.post('/yjs/pull', { after: validCursors }, {
    timeoutMs: 30000,
  });

  return result?.updates || [];
}

/**
 * Delete remote updates that have been compacted into a snapshot.
 * @param {string[]} keys - filenames to delete
 * @returns {Promise<{deleted: number}>}
 */
export async function deleteRemoteUpdates(keys) {
  if (!keys || keys.length === 0) {
    return { deleted: 0 };
  }

  const client = getClient();

  const result = await client.delete('/yjs/updates', {
    body: { keys },
    timeoutMs: 15000,
  });

  return result || { deleted: 0 };
}

/**
 * Fetch a single stored blob by key.
 * @param {string} key
 * @returns {Promise<string | null>} base64 blob, or null when the key is absent.
 */
export async function fetchUpdate(key) {
  const client = getClient();
  try {
    const result = await client.get(
      `/yjs/updates/${encodeURIComponent(key)}`,
      { timeoutMs: 15000 }
    );
    return result?.data ?? null;
  } catch (e) {
    if (e?.status === 404) return null;
    throw e;
  }
}

function getDeviceLabel() {
  try {
    const platform = typeof navigator !== 'undefined' ? navigator.platform : 'Unknown';
    return `Beaver Notes (${platform})`;
  } catch {
    return 'Beaver Notes';
  }
}
