/**
 * Remote Yjs sync transport — mirrors the folder sync protocol over HTTP.
 *
 * pushUpdates()  → POST /yjs/push-batch  (encrypted Yjs updates)
 * pullUpdates()   → POST /yjs/pull-batch  (returns updates since cursor)
 * deleteRemoteUpdates() → DELETE /yjs/updates (after compaction)
 *
 * The server stores updates in SQLite, keyed by workspaceId + noteId.
 *
 * All requests are automatically chunked to stay under the server's
 * body size limit (default 10MB, configurable via YJS_SYNC_BODY_LIMIT_BYTES).
 */

import { getApiClient } from '@/lib/api/client.js';
import { getSyncDeviceId } from './sync-repository.js';

const MAX_BATCH_BODY_BYTES = 5 * 1024 * 1024; // 5MB safe limit per request
const MAX_BATCH_ITEMS = 50; // server-side array length limit

let apiClient = null;

function getClient() {
  if (!apiClient) {
    apiClient = getApiClient();
  }
  return apiClient;
}

function chunkItems(items, getItemSize) {
  const chunks = [];
  let current = [];
  let currentSize = 0;

  for (const item of items) {
    const size = getItemSize(item);
    if (
      (current.length >= MAX_BATCH_ITEMS || currentSize + size > MAX_BATCH_BODY_BYTES) &&
      current.length > 0
    ) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(item);
    currentSize += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Push local Yjs updates to the remote server.
 * Supports single or multiple notes. Automatically chunks large payloads.
 * @param {string} workspaceId
 * @param {Array<{noteId: string, updates: Array<{key: string, data: string}>}>} notes
 * @returns {Promise<{stored: number, sizeBytes: number}>}
 */
export async function pushUpdates(workspaceId, notes) {
  if (!notes || notes.length === 0) {
    return { stored: 0, sizeBytes: 0 };
  }

  const client = getClient();
  const deviceId = getSyncDeviceId();

  const chunks = chunkItems(notes, (n) => JSON.stringify(n).length);

  let totalStored = 0;
  let totalSizeBytes = 0;

  for (const chunk of chunks) {
    const result = await client.post('/yjs/push-batch', { workspaceId, notes: chunk }, {
      headers: {
        'X-Device-Id': deviceId,
        'X-Device-label': getDeviceLabel(),
      },
      timeoutMs: 60000,
    });
    totalStored += result?.stored || 0;
    totalSizeBytes += result?.sizeBytes || 0;
  }

  return { stored: totalStored, sizeBytes: totalSizeBytes };
}

/**
 * Pull remote updates since the given cursor watermark.
 * Supports single or multiple notes. Automatically chunks large payloads.
 * @param {string} workspaceId
 * @param {Array<{noteId: string, cursors: Object}>} notes
 * @returns {Promise<Object>} { [noteId]: Array<{key: string, data: string}> }
 */
export async function pullUpdates(workspaceId, notes) {
  const client = getClient();

  const payload = notes.map(({ noteId, cursors }) => {
    const validCursors = {};
    for (const [key, val] of Object.entries(cursors || {})) {
      if (val && typeof val === 'object' && typeof val.ts === 'number' && typeof val.seq === 'number') {
        validCursors[key] = val;
      }
    }
    return { noteId, after: validCursors };
  });

  const chunks = chunkItems(payload, (n) => JSON.stringify(n).length);
  const mergedResult = {};

  for (const chunk of chunks) {
    const result = await client.post('/yjs/pull-batch', { workspaceId, notes: chunk }, {
      timeoutMs: 60000,
    });
    if (result?.notes) {
      Object.assign(mergedResult, result.notes);
    }
  }

  return mergedResult;
}

/**
 * Delete remote updates that have been compacted into a snapshot.
 * @param {string} workspaceId
 * @param {string} noteId
 * @param {string[]} keys - filenames to delete
 * @returns {Promise<{deleted: number}>}
 */
export async function deleteRemoteUpdates(workspaceId, noteId, keys) {
  if (!keys || keys.length === 0) {
    return { deleted: 0 };
  }

  const client = getClient();

  const result = await client.delete('/yjs/updates', {
    body: { workspaceId, noteId, keys },
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
