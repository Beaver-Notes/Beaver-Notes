export const DELETED_IDS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function pruneExpiredIds(deletedIds) {
  const cutoff = Date.now() - DELETED_IDS_TTL_MS;
  let dirty = false;
  for (const id of Object.keys(deletedIds)) {
    if (deletedIds[id] < cutoff) {
      delete deletedIds[id];
      dirty = true;
    }
  }
  return dirty;
}

export function collectExpiredIds(deletedIds, days = 30) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return Object.entries(deletedIds || {})
    .filter(([, timestamp]) => timestamp < cutoff)
    .map(([id]) => id);
}
