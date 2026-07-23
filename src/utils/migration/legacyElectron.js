import { backend } from '@/lib/tauri-bridge';
import {
  getMigrationStatus,
  runMigration,
  runMigrationFromPath,
  probeMigrationPath,
  readLegacyData,
  writeLegacyData,
} from '@/lib/native/app';
import { findLegacyLockedNotes, unwrapLegacyData } from '@/utils/platform/legacyLock';
import {
  decryptNoteWithPassword,
  encryptNoteWithPassword,
} from '@/utils/crypto/noteCrypto';

const isMobile = () => backend.isMobileRuntime?.();

function requireDesktop() {
  if (isMobile()) {
    throw new Error('Legacy migration is only available on desktop.');
  }
}

async function readLegacyWithLocked(dir) {
  const content = await readLegacyData(dir);
  if (!content) return { data: null, notes: [] };
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { data: null, notes: [] };
  }
  const data = unwrapLegacyData(parsed);
  const { notes } = findLegacyLockedNotes(data);
  return { data, notes };
}

export async function getLegacyMigrationStatus() {
  if (isMobile()) {
    return {
      legacyDir: null,
      appDir: null,
      hasLegacyData: false,
      alreadyMigrated: false,
      targetHasData: false,
    };
  }
  return getMigrationStatus();
}

export async function probeLegacyPath(path) {
  if (isMobile()) return { hasLegacyData: false };
  return probeMigrationPath(path);
}

export async function runLegacyMigration() {
  requireDesktop();
  await runMigration();
}

export async function runLegacyMigrationFromPath(path) {
  requireDesktop();
  await runMigrationFromPath(path);
}

export async function detectLegacyLockedNotes(dir) {
  try {
    const { notes } = await readLegacyWithLocked(dir);
    return { hasLocked: notes.length > 0, count: notes.length, notes };
  } catch (err) {
    console.error('[legacy-electron] detectLockedNotes error:', err);
    return { hasLocked: false, count: 0, notes: [] };
  }
}

export async function migrateLegacyLockedNotes(dir, password, setSharedKey) {
  const { data, notes: lockedNotes } = await readLegacyWithLocked(dir);
  if (!data || !lockedNotes.length) return 0;

  let migrated = 0;
  for (const note of lockedNotes) {
    try {
      const ciphertext = note.content?.content?.[0];
      if (!ciphertext) continue;
      const { plaintext } = await decryptNoteWithPassword(ciphertext, password);
      const v2cipher = await encryptNoteWithPassword(plaintext, password);
      note.content = { type: 'doc', content: [v2cipher] };
      note.isLocked = true;
      note.updatedAt = Date.now();
      migrated += 1;
    } catch (err) {
      console.warn(`[legacy-electron] failed to migrate note ${note.id}:`, err);
    }
  }

  if (migrated > 0) {
    await writeLegacyData(dir, JSON.stringify(data, null, 2));
  }
  if (setSharedKey) await setSharedKey(password);
  return migrated;
}
