import { LEGACY_CRYPTOJS_PREFIX } from '@/utils/noteCrypto';

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
    const hasLegacyCipher =
      typeof n.content?.content?.[0] === 'string' &&
      n.content.content[0].startsWith(LEGACY_CRYPTOJS_PREFIX);
    return (n.isLocked || lockedIds.has(n.id)) && hasLegacyCipher;
  });

  return {
    hasLocked: lockedNotes.length > 0,
    count: lockedNotes.length,
    notes: lockedNotes,
  };
}
