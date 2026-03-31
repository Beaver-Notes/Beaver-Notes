import { useStorage } from '@/composable/storage';

const storage = useStorage();

export async function applyRemoteOp(op, remoteVector) {
  const { type, id, data } = op;

  switch (type) {
    case 'notes':
      return applyNote(id, data, remoteVector);
    case 'folders':
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
  // Surgical read/write: touch only the single row, not the entire notes object.
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
  // Surgical read/write: touch only the single row, not the entire folders object.
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
