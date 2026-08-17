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
import { useAccountStore } from '@/store/account';

const MAX_BATCH_BODY_BYTES = 5 * 1024 * 1024; // 5MB safe limit per request
const MAX_BATCH_ITEMS = 50; // server-side array length limit

let apiClient = null;
let lastServerUrl = null;

function getClient() {
  let serverUrl;
  try {
    const accountStore = useAccountStore();
    serverUrl = accountStore?.serverUrl;
  } catch {
    serverUrl = undefined;
  }

  if (apiClient && serverUrl === lastServerUrl) {
    return apiClient;
  }
  lastServerUrl = serverUrl;
  apiClient = getApiClient(serverUrl ? { baseUrl: serverUrl } : undefined);
  return apiClient;
}

export function resetSyncApiClient() {
  apiClient = null;
  lastServerUrl = null;
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
 * Push local Yjs updates to the remote server using the durable identity
 * contract. The transport supplies deviceId, sequence, and ts per update.
 * @param {string} workspaceId
 * @param {Array<{noteId: string, updates: Array<{key: string, data: string}>}>} notes
 * @returns {Promise<{accepted: number, duplicate: number, checkpoints: Object}>}
 */
export async function pushUpdates(workspaceId, notes) {
  if (!notes || notes.length === 0) {
    return { accepted: 0, duplicate: 0, checkpoints: {} };
  }

  const client = getClient();
  const deviceId = getSyncDeviceId();

  const chunks = chunkItems(notes, (n) => JSON.stringify(n).length);

  let accepted = 0;
  let duplicate = 0;
  const checkpoints = {};

  for (const chunk of chunks) {
    const result = await client.post('/yjs/push-batch', { workspaceId, notes: chunk }, {
      headers: {
        'X-Device-Id': deviceId,
        'X-Device-label': getDeviceLabel(),
      },
      timeoutMs: 60000,
    });
    accepted += Number(result?.accepted) || 0;
    duplicate += Number(result?.duplicate) || 0;
    const acknowledged = result?.checkpoints && typeof result.checkpoints === 'object'
      ? result.checkpoints
      : result?.checkpoint && chunk.length === 1
        ? { [chunk[0].noteId]: result.checkpoint }
        : {};
    for (const [noteId, checkpoint] of Object.entries(acknowledged)) {
      checkpoints[noteId] = checkpoint;
    }
  }

  return { accepted, duplicate, checkpoints };
}

/**
 * Pull remote updates since the given cursor watermark.
 * Supports single or multiple notes. Automatically chunks large payloads.
 * @param {string} workspaceId
 * @param {Array<{noteId: string, cursors: Object}>} notes
 * @returns {Promise<Object>} { notes: { [noteId]: { updates: Array<{key: string, data: string}>, nextCheckpoint?: Object, hasMore?: boolean } } }
 */
export async function pullUpdates(workspaceId, notes) {
  const client = getClient();

  const payload = notes.map(({ noteId, checkpoint, limit = 500 }) => ({
    noteId,
    checkpoint: checkpoint || null,
    limit,
  }));

  const chunks = chunkItems(payload, (n) => JSON.stringify(n).length);
  const mergedResult = {};

  for (const chunk of chunks) {
    const result = await client.post('/yjs/pull-batch', { workspaceId, notes: chunk }, {
      timeoutMs: 60000,
    });
    if (result?.notes) Object.assign(mergedResult, result.notes);
  }

  return { notes: mergedResult };
}

export async function getRemoteState(workspaceId) {
  if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
    const error = new Error('Workspace ID is required to fetch remote sync state');
    error.code = 'sync-state-invalid';
    throw error;
  }
  const client = getClient();
  const state = await client.get(`/sync/state?workspaceId=${encodeURIComponent(workspaceId)}`, {
    timeoutMs: 15000,
  });
  const statuses = new Set(['empty', 'initializing', 'initialized', 'recovering']);
  if (!state || !statuses.has(state.status) || !Array.isArray(state.documents)) {
    const error = new Error('Remote sync state payload is malformed');
    error.code = 'sync-state-invalid';
    throw error;
  }
  return state;
}

export async function claimInitialization(workspaceId) {
  return getClient().post('/sync/initialize/claim', { workspaceId }, { timeoutMs: 15000 });
}

export async function resetInitialization(workspaceId) {
  return getClient().post('/sync/initialize/reset', { workspaceId }, { timeoutMs: 15000 });
}

export async function uploadInitializationSnapshot(workspaceId, token, noteId, generation, data) {
  return getClient().post('/sync/initialize/snapshot', {
    workspaceId,
    token,
    noteId,
    generation,
    data,
  }, { timeoutMs: 60000 });
}

export async function completeInitialization(workspaceId, token, generation, documents, assets = []) {
  return getClient().post('/sync/initialize/complete', {
    workspaceId,
    token,
    generation,
    documents,
    assets,
  }, { timeoutMs: 30000 });
}

export async function getSnapshotUrls(workspaceId, token, noteIds) {
  return getClient().post('/sync/initialize/snapshot-urls', {
    workspaceId,
    token,
    noteIds,
  }, { timeoutMs: 30000 });
}

export async function getSnapshotDownloadUrls(workspaceId, noteIds) {
  return getClient().post('/sync/snapshot-download-urls', {
    workspaceId,
    noteIds,
  }, { timeoutMs: 30000 });
}

export async function createWorkspace(name, orgId) {
  return getClient().post('/workspaces', { name, orgId }, { timeoutMs: 15000 });
}

export async function getWorkspaces() {
  return getClient().get('/workspaces', { timeoutMs: 15000 });
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

/**
 * List all distinct noteIds stored on the server for a workspace.
 * @param {string} workspaceId
 * @returns {Promise<string[]>}
 */
export async function listRemoteNoteIds(workspaceId) {
  try {
    const result = await getRemoteState(workspaceId);
    return result?.documents?.map((document) => document.noteId).filter(Boolean) || [];
  } catch (e) {
    console.warn('[sync] listRemoteNoteIds failed:', e?.message);
    return [];
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
