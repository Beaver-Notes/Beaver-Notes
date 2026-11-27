import { backend } from '@/lib/tauri-bridge';
import {
  getMigrationStatus,
  runMigration,
  runMigrationFromPath,
  probeMigrationPath,
  readLegacyData,
} from '@/lib/native/app';
import { base64ToBuf, bufToHex, hexToBuf } from '@/utils/crypto/codec.js';
import { findLegacyLockedNotes, unwrapLegacyData } from '@/utils/platform/legacyLock';
import {
  decryptLegacyCryptoJSNote,
  deriveArgon2Key,
} from '@/lib/native/security.js';
import {
  ALGO_AES_GCM,
  ALGO_PBKDF2,
  ENVELOPE_VERSION,
  NOTE_ENVELOPE_VERSION_ARGON2,
  HASH_SHA_256,
  PBKDF2_ITERATIONS,
} from '@/utils/crypto/constants.js';

// Legacy per-note encryption functions kept only for migration.
const LEGACY_CRYPTOJS_PREFIX = 'U2FsdGVk';
const NOTE_CRYPTO_ERROR = 'Incorrect password';

async function _noteKeyArgon2(password, saltBuf) {
  const saltHex = bufToHex(saltBuf);
  const rawHex = await deriveArgon2Key(password, saltHex);
  const raw = hexToBuf(rawHex);
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: ALGO_AES_GCM, length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function _noteKeyPbkdf2(password, saltBuf) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    ALGO_PBKDF2,
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: ALGO_PBKDF2,
      salt: saltBuf,
      iterations: PBKDF2_ITERATIONS,
      hash: HASH_SHA_256,
    },
    keyMaterial,
    { name: ALGO_AES_GCM, length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function decryptNoteWithPassword(ciphertext, password) {
  if (typeof ciphertext !== 'string' || !ciphertext) {
    throw new Error(NOTE_CRYPTO_ERROR);
  }

  if (ciphertext.startsWith(LEGACY_CRYPTOJS_PREFIX)) {
    try {
      const plaintext = await decryptLegacyCryptoJSNote(ciphertext, password);
      return { plaintext, wasLegacy: true };
    } catch {
      throw new Error(NOTE_CRYPTO_ERROR);
    }
  }

  let parsed = null;
  try {
    parsed = JSON.parse(ciphertext);
  } catch {
    throw new Error(NOTE_CRYPTO_ERROR);
  }

  if (parsed?.v === NOTE_ENVELOPE_VERSION_ARGON2) {
    const key = await _noteKeyArgon2(password, hexToBuf(parsed.salt));
    let buf;
    try {
      buf = await crypto.subtle.decrypt(
        { name: ALGO_AES_GCM, iv: hexToBuf(parsed.iv) },
        key,
        base64ToBuf(parsed.cipher)
      );
    } catch {
      throw new Error(NOTE_CRYPTO_ERROR);
    }
    return { plaintext: new TextDecoder().decode(buf), wasLegacy: false };
  }

  if (parsed?.v === ENVELOPE_VERSION) {
    const key = await _noteKeyPbkdf2(password, hexToBuf(parsed.salt));
    let buf;
    try {
      buf = await crypto.subtle.decrypt(
        { name: ALGO_AES_GCM, iv: hexToBuf(parsed.iv) },
        key,
        base64ToBuf(parsed.cipher)
      );
    } catch {
      throw new Error(NOTE_CRYPTO_ERROR);
    }
    return { plaintext: new TextDecoder().decode(buf), wasLegacy: false };
  }

  throw new Error(NOTE_CRYPTO_ERROR);
}

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

/**
 * Validate the legacy locked-notes password WITHOUT writing anything back:
 * decrypts (read-only) the first locked note to confirm the password; throws
 * on a wrong password so callers keep the "Incorrect password" error path.
 * Actual decryption + Yjs conversion happens later in convertLegacyNotesToYjs.
 */
export async function validateLegacyLockedPassword(dir, password) {
  const { data, notes: lockedNotes } = await readLegacyWithLocked(dir);
  if (!data || lockedNotes.length === 0) {
    return { ok: true, count: 0 };
  }

  // First locked note only: proves password, persists nothing.
  const first = lockedNotes[0];
  const ciphertext = first?.content?.content?.[0];
  if (typeof ciphertext === 'string' && ciphertext) {
    await decryptNoteWithPassword(ciphertext, password);
  }
  return { ok: true, count: lockedNotes.length };
}

