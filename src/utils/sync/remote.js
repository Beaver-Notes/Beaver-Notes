import { useStorage } from '@/composable/storage';
import { encryptJSON, decryptJSON } from './crypto.js';
import { getApiClient } from '@/lib/api/client';
import { ApiError } from '@/lib/api/client';
import { useAccountStore } from '@/store/account';
import {
  applySnapshotData,
  buildCommit,
  buildSnapshot,
  getSyncDeviceId,
  nextLocalClock,
} from './common.js';
import { STORAGE_KEY } from './constants.js';

const storage = useStorage();

const SYNC_COMMIT_BLOB_LIMIT = 1024 * 1024;

function getRemoteClient() {
  const accountStore = useAccountStore();
  const baseUrl = accountStore.serverUrl;
  if (!baseUrl) return null;
  return getApiClient({ baseUrl });
}

function getDeviceIdHeader() {
  return getSyncDeviceId();
}

function getDeviceLabelHeader() {
  try {
    const ua = navigator?.userAgent || '';
    const platform = (navigator?.platform || '').trim();
    let os = 'Unknown OS';
    if (/Mac/.test(platform) || /Mac OS X/.test(ua)) os = 'macOS';
    else if (/Windows/.test(platform) || /Windows NT/.test(ua)) os = 'Windows';
    else if (/Linux/.test(platform) && !/Android/.test(ua)) os = 'Linux';
    else if (/Android/.test(ua)) os = 'Android';
    else if (/iPhone/.test(ua)) os = 'iOS';
    else if (/iPad/.test(ua)) os = 'iPadOS';
    const browser = /Edg\//.test(ua)
      ? 'Edge'
      : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Safari\//.test(ua)
      ? 'Safari'
      : 'Browser';
    return `${browser} on ${os}`;
  } catch {
    return 'Unknown Device';
  }
}

function loadCursors() {
  return storage.get(STORAGE_KEY.SYNC_CURSORS, {}, 'settings');
}

function saveCursors(cursors) {
  return storage.set(STORAGE_KEY.SYNC_CURSORS, cursors, 'settings');
}

function formatAfter(cursors) {
  if (!cursors || typeof cursors !== 'object') return '';
  return Object.entries(cursors)
    .filter(
      ([deviceId, clock]) => deviceId && Number.isFinite(clock) && clock > 0
    )
    .map(([deviceId, clock]) => `${encodeURIComponent(deviceId)}:${clock}`)
    .join(',');
}

// The sync backend only accepts flat asset keys matching ^[a-zA-Z0-9._-]{1,256}$
// (no '/'), so we collapse the logical `assetType/noteId/file` identity into a
// single segment: `assetType.noteId.b64url(file)`. '.' is the delimiter; noteId
// and the base64url filename contain no '.', so split('.') is unambiguous.
function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(b64) {
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const binary = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function flattenAssetKey(assetType, noteId, file) {
  return `${assetType}.${noteId}.${b64urlEncode(file)}`;
}

export async function remoteReady() {
  const accountStore = useAccountStore();
  if (accountStore.status !== 'authenticated') return false;
  if (!accountStore.serverUrl) return false;
  if (!accountStore.isPaidPlan) return false;
  return true;
}

export async function listRemoteCommits(cursors) {
  const client = getRemoteClient();
  if (!client) return [];
  const after = formatAfter(cursors);
  const list = await client.get('/commits', {
    query: after ? { after } : undefined,
  });
  const metas = Array.isArray(list?.commits) ? list.commits : [];
  if (!metas.length) return [];

  const device = getSyncDeviceId();
  const fresh = [];
  for (const meta of metas) {
    if (meta.deviceId === device) continue;
    const seenUpTo = cursors[meta.deviceId] ?? 0;
    if (meta.clock <= seenUpTo) continue;
    try {
      const blob = await client.get(
        `/commits/${encodeURIComponent(meta.commitId)}`
      );
      const commit = await decryptJSON(blob);
      if (!commit?.device || !commit?.clock) continue;
      fresh.push(commit);
    } catch (err) {
      console.warn('[sync-remote] listRemoteCommits: blob fetch failed:', err);
    }
  }

  return fresh.sort((a, b) => a.ts - b.ts || a.clock - b.clock);
}

export async function writeCommit({ key, data }) {
  const client = getRemoteClient();
  if (!client) return null;
  const cursors = await loadCursors();
  const clock = await nextLocalClock(loadCursors);
  const commit = buildCommit({ key, data, cursors, clock, ts: Date.now() });

  const encrypted = await encryptJSON(commit);
  let payload;
  if (typeof encrypted === 'string') {
    try {
      payload = JSON.parse(encrypted);
    } catch {
      payload = null;
    }
  } else {
    payload = encrypted;
  }

  const opType = key.split('.')[0];
  const noteId = key.split('.')[1];
  const headers = {
    'X-Device-Id': getDeviceIdHeader(),
    'X-Device-Label': getDeviceLabelHeader(),
  };
  if (opType === 'notes' && noteId) {
    headers['X-Note-Id'] = noteId;
  }

  await client.post(
    '/commits',
    {
      id: commit.id,
      deviceId: commit.device,
      clock: commit.clock,
      ts: commit.ts,
      payload,
    },
    { headers }
  );

  cursors[commit.device] = clock;
  await saveCursors(cursors);

  return commit.id;
}

export async function remoteReadSnapshot() {
  const client = getRemoteClient();
  if (!client) return null;
  try {
    const result = await client.get('/snapshot');
    if (!result || !result.snapshot) return null;
    return await decryptJSON(result.snapshot);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export async function applySnapshotIfNeeded() {
  const snapshot = await remoteReadSnapshot();
  if (!snapshot) return false;

  const [pending, lastApplied] = await Promise.all([
    storage.get(STORAGE_KEY.SYNC_PENDING_CHANGES, {}, 'settings'),
    storage.get(STORAGE_KEY.SYNC_SNAPSHOT_TS, 0, 'settings'),
  ]);
  if (Object.keys(pending).length > 0) return false;

  const snapshotTs = Number(snapshot.ts) || 0;
  if (snapshotTs && snapshotTs <= Number(lastApplied || 0)) return false;

  return applySnapshotData(snapshot, saveCursors);
}

export async function compactSync() {
  const client = getRemoteClient();
  if (!client) return;
  const cursors = await loadCursors();
  const snapshot = await buildSnapshot(cursors);

  const encStr = await encryptJSON(snapshot);
  const encObj = typeof encStr === 'string' ? JSON.parse(encStr) : encStr;
  await client.post('/snapshot', encObj, {
    headers: { 'Content-Type': 'application/json' },
  });

  await saveCursors(cursors);
  await storage.set(STORAGE_KEY.SYNC_SNAPSHOT_TS, snapshot.ts, 'settings');
}

function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function isIgnoredAssetEntry(name) {
  return !name || name.startsWith('.') || name === 'Thumbs.db';
}

export async function syncAssets(localDir, onDeletedAssetsChanged, onProgress) {
  const client = getRemoteClient();
  if (!client) return;

  const {
    readDir: readSyncDir,
    readData,
    writeFile: writeSyncFile,
    removePath: removeSyncPath,
  } = await import('@/lib/native/fs');
  const { path: pathUtil } = await import('@/lib/tauri-bridge');

  const ASSET_TYPES = ['notes-assets', 'file-assets'];
  const deletedAssets = await storage.get(STORAGE_KEY.DELETED_ASSETS, {});
  let deletedAssetsDirty = false;

  const remoteList = await client.get('/assets').catch(() => null);
  const remoteKeys = new Set(
    Array.isArray(remoteList?.keys) ? remoteList.keys : []
  );

  const ops = [];

  for (const assetType of ASSET_TYPES) {
    const localBase = pathUtil.join(localDir, assetType);

    const localNoteIds = await readSyncDir(localBase)
      .then((e) => e.map((x) => x.name).filter((n) => !isIgnoredAssetEntry(n)))
      .catch(() => []);

    const remoteNoteIds = new Set();
    for (const key of remoteKeys) {
      const parts = key.split('.');
      if (parts.length === 3 && parts[0] === assetType) {
        remoteNoteIds.add(parts[1]);
      }
    }

    const allNoteIds = [...new Set([...localNoteIds, ...remoteNoteIds])];

    for (const noteId of allNoteIds) {
      if (isIgnoredAssetEntry(noteId)) continue;

      const localNoteDir = pathUtil.join(localBase, noteId);
      const localFiles = await readSyncDir(localNoteDir)
        .then((e) =>
          e.map((x) => x.name).filter((f) => !isIgnoredAssetEntry(f))
        )
        .catch(() => []);

      const remoteFileNames = new Set();
      for (const key of remoteKeys) {
        const parts = key.split('.');
        if (
          parts.length === 3 &&
          parts[0] === assetType &&
          parts[1] === noteId
        ) {
          remoteFileNames.add(b64urlDecode(parts[2]));
        }
      }

      const allNames = [...new Set([...localFiles, ...remoteFileNames])];

      for (const file of allNames) {
        // `deletedAssets` uses the logical `assetType/noteId/file` key so it
        // stays consistent with the folder transport and trackDeletedAssets.
        const logicalKey = `${assetType}/${noteId}/${file}`;
        const assetKey = flattenAssetKey(assetType, noteId, file);
        const hasLocally = localFiles.includes(file);
        const hasRemotely = remoteFileNames.has(file);

        if (deletedAssets[logicalKey] && hasLocally) {
          delete deletedAssets[logicalKey];
          deletedAssetsDirty = true;
        }

        if (deletedAssets[logicalKey]) {
          if (hasLocally)
            ops.push({ type: 'remove-local', noteId, file, assetType });
          if (hasRemotely)
            ops.push({ type: 'remove-remote', noteId, file, assetType });
          continue;
        }

        if (hasRemotely && !hasLocally) {
          ops.push({ type: 'download', noteId, file, assetType });
        }
        if (hasLocally && !hasRemotely) {
          ops.push({ type: 'upload', noteId, file, assetType });
        }
      }
    }
  }

  const total = ops.length;
  let processed = 0;
  onProgress?.({ phase: 'scan', processed: 0, total });

  for (const op of ops) {
    try {
      if (op.type === 'upload') {
        const localPath = pathUtil.join(
          localDir,
          op.assetType,
          op.noteId,
          op.file
        );
        const data = await readData(localPath);
        if (data != null) {
          const bytes =
            data instanceof Uint8Array
              ? data
              : typeof data === 'string'
              ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
              : new Uint8Array(0);
          const key = flattenAssetKey(op.assetType, op.noteId, op.file);
          await client.put(`/assets/${encodeURIComponent(key)}`, bytes, {
            headers: { 'Content-Type': 'application/octet-stream' },
          });
        }
      } else if (op.type === 'download') {
        const key = flattenAssetKey(op.assetType, op.noteId, op.file);
        const result = await client.get(`/assets/${encodeURIComponent(key)}`);
        if (result?.url) {
          const resp = await fetch(result.url);
          const bytes = new Uint8Array(await resp.arrayBuffer());
          const localPath = pathUtil.join(
            localDir,
            op.assetType,
            op.noteId,
            op.file
          );
          await writeSyncFile(localPath, bytes);
        }
      } else if (op.type === 'remove-local') {
        const localPath = pathUtil.join(
          localDir,
          op.assetType,
          op.noteId,
          op.file
        );
        await removeSyncPath(localPath).catch(() => {});
      } else if (op.type === 'remove-remote') {
        const key = flattenAssetKey(op.assetType, op.noteId, op.file);
        await client.delete(`/assets/${encodeURIComponent(key)}`);
      }
    } catch (err) {
      console.warn('[sync-remote] asset op failed:', op, err);
    }
    processed += 1;
    if (processed % 3 === 0) {
      await yieldToUi();
      onProgress?.({ phase: 'assets', processed, total });
    }
  }

  if (processed > 0) {
    onProgress?.({ phase: 'assets', processed, total });
  }

  if (deletedAssetsDirty) {
    await storage.set(STORAGE_KEY.DELETED_ASSETS, deletedAssets);
    await onDeletedAssetsChanged(deletedAssets);
  }
}
