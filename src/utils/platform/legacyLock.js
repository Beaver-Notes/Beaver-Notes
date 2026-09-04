const LEGACY_CRYPTOJS_PREFIX = 'U2FsdGVk';
const LEGACY_JSON_PREFIX = '{';

export function unwrapLegacyData(raw) {
  if (raw && typeof raw === 'object' && raw.data && !raw.notes) {
    return raw.data;
  }
  return raw;
}

export function findLegacyLockedNotes(data) {
  const notesMap = data?.notes || {};
  const lockStatus = data?.lockStatus || {};
  const isLockedMap = data?.isLocked || {};

  const lockedIds = new Set([
    ...Object.entries(lockStatus)
      .filter(([, v]) => v === 'locked')
      .map(([k]) => k),
    ...Object.entries(isLockedMap)
      .filter(([, v]) => v === true)
      .map(([k]) => k),
  ]);

  const lockedNotes = Object.values(notesMap).filter((n) => {
    const first = n.content?.content?.[0];
    const hasLegacyCipher =
      typeof first === 'string' &&
      (first.startsWith(LEGACY_CRYPTOJS_PREFIX) ||
        first.startsWith(LEGACY_JSON_PREFIX));
    return (n.isLocked || lockedIds.has(n.id)) && hasLegacyCipher;
  });

  return {
    hasLocked: lockedNotes.length > 0,
    count: lockedNotes.length,
    notes: lockedNotes,
  };
}
