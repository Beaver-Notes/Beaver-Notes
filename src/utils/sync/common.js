import { toRaw } from 'vue';
import { useStorage } from '@/composable/storage';
import { OpType, STORAGE_KEY } from './constants.js';

const storage = useStorage();

let deviceId =
  localStorage.getItem('deviceId') ||
  (() => {
    const id = crypto.randomUUID().replace(/-/g, '');
    localStorage.setItem('deviceId', id);
    return id;
  })();

let localClock = null;
let localClockInitPromise = null;

export function getSyncDeviceId() {
  return deviceId;
}

export function cloneCommitData(data) {
  if (data === undefined || data === null) return null;
  return JSON.parse(JSON.stringify(toRaw(data)));
}

export function buildCommit({ key, data, cursors, clock, ts }) {
  const [type, id] = key.split('.');
  const safeCursors = cursors && typeof cursors === 'object' ? cursors : {};
  const safeClock = Number.isFinite(clock) ? clock : 0;
  const safeTs = Number.isFinite(ts) ? ts : Date.now();

  return {
    id: `${safeTs}-${deviceId}-${safeClock}`,
    device: deviceId,
    ts: safeTs,
    clock: safeClock,
    vector: { ...safeCursors, [deviceId]: safeClock },
    ops: [
      {
        type,
        id: id || type,
        data: cloneCommitData(data),
      },
    ],
  };
}

export async function initLocalClockIfNeeded(loadCursors) {
  if (localClock !== null) return;
  if (!localClockInitPromise) {
    localClockInitPromise = (async () => {
      const [savedClock, cursors] = await Promise.all([
        storage.get(STORAGE_KEY.SYNC_LOCAL_CLOCK, 0, 'settings'),
        loadCursors(),
      ]);
      const fromSettings = Number.isFinite(Number(savedClock))
        ? Number(savedClock)
        : 0;
      const fromCursor = Number.isFinite(Number(cursors?.[deviceId]))
        ? Number(cursors[deviceId])
        : 0;
      localClock = Math.max(0, fromSettings, fromCursor);
    })();
  }
  await localClockInitPromise;
}

export async function nextLocalClock(loadCursors) {
  await initLocalClockIfNeeded(loadCursors);
  localClock += 1;
  await storage.set(STORAGE_KEY.SYNC_LOCAL_CLOCK, localClock, 'settings');
  return localClock;
}

export function compareVectors(remote, local) {
  const devices = [...new Set([...Object.keys(remote), ...Object.keys(local)])];
  let remoteAhead = false;
  let localAhead = false;

  for (const device of devices) {
    const remoteClock = remote[device] ?? 0;
    const localClock = local[device] ?? 0;
    if (remoteClock > localClock) remoteAhead = true;
    if (localClock > remoteClock) localAhead = true;
  }

  if (remoteAhead && !localAhead) return 'remote-wins';
  if (localAhead && !remoteAhead) return 'local-wins';
  if (!remoteAhead && !localAhead) return 'remote-wins';
  return 'concurrent';
}

export function mergeVectors(a, b) {
  const result = { ...a };
  for (const [device, vector] of Object.entries(b)) {
    result[device] = Math.max(result[device] ?? 0, vector);
  }
  return result;
}

export async function applyRemoteOp(op, remoteVector) {
  const { type, id, data } = op;

  if (!type || typeof type !== 'string') {
    console.error('[sync] Skipping invalid op — missing/invalid type', op);
    return;
  }

  switch (type) {
    case 'notes':
      if (!id || typeof id !== 'string') {
        console.error(
          '[sync] Skipping invalid note op — missing/invalid id',
          op
        );
        return;
      }
      return applyNote(id, data, remoteVector);
    case 'folders':
      if (!id || typeof id !== 'string') {
        console.error(
          '[sync] Skipping invalid folder op — missing/invalid id',
          op
        );
        return;
      }
      return applyFolder(id, data, remoteVector);
    case 'labels':
      return applyLabels(data);
    case 'deletedIds':
      return applyDeletedMap('deletedIds', data);
    case 'deletedFolderIds':
      return applyDeletedMap('deletedFolderIds', data);
    case 'labelColors':
      return applyLabelColors(data);
    case 'deletedAssets':
      return applyDeletedAssets(data);
    default:
      console.warn('[sync] Unknown op type:', type);
  }
}

async function applyNote(id, data, remoteVector) {
  if (!data) {
    await storage.delete(`notes.${id}`);
    return;
  }

  const existing = await storage.get(`notes.${id}`, null);

  if (!existing) {
    await storage.set(`notes.${id}`, { ...data, _vector: remoteVector });
    return;
  }

  const localVector = existing._vector ?? {};
  const comparison = compareVectors(remoteVector, localVector);

  if (comparison === 'local-wins') {
    return;
  }

  if (comparison === 'concurrent') {
    const conflictId = `${id}-conflict-${Date.now()}`;
    const conflictNote = {
      ...existing,
      id: conflictId,
      title: `${existing.title || 'Untitled'} (conflict copy)`,
      isConflict: true,
      conflictOf: id,
      _vector: localVector,
    };
    await storage.set(`notes.${conflictId}`, conflictNote);
  }

  await storage.set(`notes.${id}`, {
    ...data,
    isBookmarked: existing.isBookmarked || data.isBookmarked,
    isLocked: existing.isLocked || data.isLocked,
    labels: [...new Set([...(existing.labels ?? []), ...(data.labels ?? [])])],
    _vector: mergeVectors(remoteVector, localVector),
  });
}

async function applyFolder(id, data, remoteVector) {
  if (!data) {
    await storage.delete(`folders.${id}`);
    return;
  }

  const existing = await storage.get(`folders.${id}`, null);

  if (!existing) {
    await storage.set(`folders.${id}`, { ...data, _vector: remoteVector });
    return;
  }

  const localVector = existing._vector ?? {};
  const comparison = compareVectors(remoteVector, localVector);

  if (comparison === 'local-wins') return;

  if (comparison === 'concurrent') {
    const conflictId = `${id}-conflict-${Date.now()}`;
    const conflictFolder = {
      ...existing,
      id: conflictId,
      name: `${existing.name || 'Untitled'} (conflict copy)`,
      isConflict: true,
      conflictOf: id,
      _vector: localVector,
    };
    await storage.set(`folders.${conflictId}`, conflictFolder);
  }

  await storage.set(`folders.${id}`, {
    ...data,
    _vector: mergeVectors(remoteVector, localVector),
  });
}

async function applyLabels(data) {
  if (!data) return;
  const local = await storage.get('labels', []);
  const merged = [...new Set([...local, ...(Array.isArray(data) ? data : [])])];
  await storage.set('labels', merged);
}

async function applyDeletedMap(key, data) {
  if (!data) return;
  const current = await storage.get(key, {});
  await storage.set(key, { ...current, ...data });
}

async function applyDeletedAssets(data) {
  if (!data) return;
  const current = await storage.get('deletedAssets', {});
  await storage.set('deletedAssets', { ...current, ...data });
}

async function applyLabelColors(data) {
  if (!data) return;
  const current = await storage.get('labelColors', {});
  await storage.set('labelColors', { ...current, ...data });
}

export async function applySnapshotData(snapshot, saveCursors) {
  if (!snapshot || !snapshot.data || typeof snapshot.data !== 'object') {
    return false;
  }

  const writes = [];
  for (const [id, note] of Object.entries(snapshot.data[OpType.NOTES] ?? {})) {
    writes.push(storage.set(`notes.${id}`, note));
  }
  for (const [id, folder] of Object.entries(
    snapshot.data[OpType.FOLDERS] ?? {}
  )) {
    writes.push(storage.set(`folders.${id}`, folder));
  }
  writes.push(storage.set(OpType.LABELS, snapshot.data[OpType.LABELS] ?? []));
  writes.push(
    storage.set(OpType.DELETED_IDS, snapshot.data[OpType.DELETED_IDS] ?? {})
  );
  writes.push(
    storage.set(
      OpType.DELETED_FOLDER_IDS,
      snapshot.data[OpType.DELETED_FOLDER_IDS] ?? {}
    )
  );
  writes.push(
    storage.set(
      OpType.DELETED_ASSETS,
      snapshot.data[OpType.DELETED_ASSETS] ?? {}
    )
  );

  await Promise.all(writes);

  await saveCursors(
    snapshot.cursors && typeof snapshot.cursors === 'object'
      ? snapshot.cursors
      : {}
  );
  const snapshotTs = Number(snapshot.ts) || Date.now();
  await storage.set(STORAGE_KEY.SYNC_SNAPSHOT_TS, snapshotTs, 'settings');
  return true;
}

export async function buildSnapshot(cursors) {
  const snapshotTs = Date.now();
  return {
    ts: snapshotTs,
    cursors,
    data: {
      [OpType.NOTES]: await storage.get('notes', {}),
      [OpType.FOLDERS]: await storage.get('folders', {}),
      [OpType.LABELS]: await storage.get('labels', {}),
      [OpType.DELETED_IDS]: await storage.get('deletedIds', {}),
      [OpType.DELETED_FOLDER_IDS]: await storage.get('deletedFolderIds', {}),
      [OpType.DELETED_ASSETS]: await storage.get('deletedAssets', {}),
    },
  };
}

export async function queuePendingChange(key, data) {
  const pending = await storage.get(
    STORAGE_KEY.SYNC_PENDING_CHANGES,
    {},
    'settings'
  );
  pending[key] = {
    ts: Date.now(),
    data: cloneCommitData(data),
  };
  await storage.set(STORAGE_KEY.SYNC_PENDING_CHANGES, pending, 'settings');
}

export async function flushPendingChanges(writePendingCommit) {
  const pending = await storage.get(
    STORAGE_KEY.SYNC_PENDING_CHANGES,
    {},
    'settings'
  );
  const entries = Object.entries(pending).sort(
    (a, b) => (a[1]?.ts ?? 0) - (b[1]?.ts ?? 0)
  );
  if (!entries.length) return 0;

  for (const [key, payload] of entries) {
    await writePendingCommit(key, payload?.data ?? null);
  }

  await storage.delete(STORAGE_KEY.SYNC_PENDING_CHANGES, 'settings');
  return entries.length;
}

export async function flushPendingChangesIfReady(
  ensureSyncKeyReadyForWrite,
  writePendingCommit
) {
  const pending = await storage.get(
    STORAGE_KEY.SYNC_PENDING_CHANGES,
    {},
    'settings'
  );
  if (Object.keys(pending).length === 0) return false;

  try {
    await ensureSyncKeyReadyForWrite();
    await flushPendingChanges(writePendingCommit);
    return true;
  } catch {
    return false;
  }
}
