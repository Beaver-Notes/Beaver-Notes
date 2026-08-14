import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bufToHex, bufToBase64 } from '@/utils/crypto/codec.js';

const {
  readLegacyDataMock,
  writeLegacyDataMock,
  deriveArgon2KeyMock,
  decryptLegacyCryptoJSMock,
  encryptContentMock,
} = vi.hoisted(() => ({
  readLegacyDataMock: vi.fn(),
  writeLegacyDataMock: vi.fn(),
  deriveArgon2KeyMock: vi.fn(),
  decryptLegacyCryptoJSMock: vi.fn(),
  encryptContentMock: vi.fn(),
}));

vi.mock('@/lib/tauri-bridge', () => ({
  backend: { isMobileRuntime: () => false },
}));

vi.mock('@/lib/native/app', () => ({
  getMigrationStatus: vi.fn(),
  runMigration: vi.fn(),
  runMigrationFromPath: vi.fn(),
  probeMigrationPath: vi.fn(),
  readLegacyData: readLegacyDataMock,
  writeLegacyData: writeLegacyDataMock,
}));

vi.mock('@/lib/native/security.js', () => ({
  decryptLegacyCryptoJSNote: decryptLegacyCryptoJSMock,
  deriveArgon2Key: deriveArgon2KeyMock,
}));

vi.mock('@/utils/crypto/encryption.js', () => ({
  encryptContent: encryptContentMock,
}));

// Same detection semantics as the real module, but also recognises JSON
// envelopes at content[0] so the Argon2/PBKDF2 migration branches are
// reachable in tests.
vi.mock('@/utils/platform/legacyLock', () => ({
  unwrapLegacyData: (raw) =>
    raw && typeof raw === 'object' && raw.data && !raw.notes ? raw.data : raw,
  findLegacyLockedNotes: (data) => {
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
        (first.startsWith('U2FsdGVk') || first.startsWith('{'));
      return (n.isLocked || lockedIds.has(n.id)) && hasLegacyCipher;
    });
    return {
      hasLocked: lockedNotes.length > 0,
      count: lockedNotes.length,
      notes: lockedNotes,
    };
  },
}));

import { migrateLegacyLockedNotes } from '../legacyElectron.js';

const ENVELOPE = { ae: 6, iv: 'deadbeef', cipher: 'c2lwaGVy' };

const PLAINTEXT_DOC = JSON.stringify({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'secret' }] },
  ],
});

function legacyData(note) {
  return {
    notes: { [note.id]: note },
    lockStatus: { [note.id]: 'locked' },
    isLocked: { [note.id]: true },
  };
}

function writtenNotes() {
  const written = writeLegacyDataMock.mock.calls[0][1];
  return JSON.parse(written).notes || JSON.parse(written).data?.notes;
}

async function legacyArgon2Envelope() {
  const key = new Uint8Array(32).fill(7);
  deriveArgon2KeyMock.mockResolvedValue(bufToHex(key));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      new TextEncoder().encode(PLAINTEXT_DOC)
    )
  );
  return {
    v: 3,
    salt: bufToHex(salt),
    iv: bufToHex(iv),
    cipher: bufToBase64(ct),
  };
}

describe('migrateLegacyLockedNotes (workspace-key re-encryption)', () => {
  beforeEach(() => {
    readLegacyDataMock.mockReset();
    writeLegacyDataMock.mockReset();
    deriveArgon2KeyMock.mockReset();
    decryptLegacyCryptoJSMock.mockReset();
    encryptContentMock.mockReset();
    encryptContentMock.mockResolvedValue(ENVELOPE);
  });

  it('re-encrypts a CryptoJS legacy locked note with the workspace key', async () => {
    const note = {
      id: 'n1',
      title: 'Locked legacy note',
      isLocked: true,
      content: { type: 'doc', content: ['U2FsdGVkX1+mockCiphertext'] },
    };
    readLegacyDataMock.mockResolvedValue(
      JSON.stringify({ data: legacyData(note) })
    );
    decryptLegacyCryptoJSMock.mockResolvedValue(PLAINTEXT_DOC);

    const migrated = await migrateLegacyLockedNotes('/legacy/dir', 'legacy-pw');

    expect(migrated).toBe(1);
    // Decrypted with the legacy password…
    expect(decryptLegacyCryptoJSMock).toHaveBeenCalledWith(
      'U2FsdGVkX1+mockCiphertext',
      'legacy-pw'
    );
    // …then re-encrypted with the WORKSPACE key via encryptContent.
    expect(encryptContentMock).toHaveBeenCalledTimes(1);
    expect(encryptContentMock).toHaveBeenCalledWith(JSON.parse(PLAINTEXT_DOC));
    expect(writeLegacyDataMock).toHaveBeenCalledTimes(1);
    // The written note's content is the workspace-encrypted ae:6 envelope.
    const migratedNote = writtenNotes()[note.id];
    expect(migratedNote.content).toStrictEqual(ENVELOPE);
    expect(migratedNote.isLocked).toBe(true);
  });

  it('decrypts an Argon2 envelope and re-encrypts with the workspace key', async () => {
    const envelopeV2 = await legacyArgon2Envelope();
    const note = {
      id: 'n2',
      title: 'Argon2 locked note',
      isLocked: true,
      content: { type: 'doc', content: [JSON.stringify(envelopeV2)] },
    };
    readLegacyDataMock.mockResolvedValue(
      JSON.stringify({ data: legacyData(note) })
    );

    const migrated = await migrateLegacyLockedNotes('/legacy/dir', 'legacy-pw');

    expect(migrated).toBe(1);
    expect(encryptContentMock).toHaveBeenCalledTimes(1);
    expect(encryptContentMock).toHaveBeenCalledWith(JSON.parse(PLAINTEXT_DOC));
    expect(writeLegacyDataMock).toHaveBeenCalledTimes(1);
    const migratedNote = writtenNotes()[note.id];
    expect(migratedNote.content).toStrictEqual(ENVELOPE);
    expect(migratedNote.isLocked).toBe(true);
  });

  it('is a no-op without locked notes and never persists the legacy password', async () => {
    readLegacyDataMock.mockResolvedValue(
      JSON.stringify({
        data: {
          notes: { n3: { id: 'n3', isLocked: false } },
          lockStatus: {},
          isLocked: {},
        },
      })
    );

    const migrated = await migrateLegacyLockedNotes('/legacy/dir', 'legacy-pw');

    expect(migrated).toBe(0);
    expect(writeLegacyDataMock).not.toHaveBeenCalled();
    expect(encryptContentMock).not.toHaveBeenCalled();
    // The migration's only side effect is writing re-encrypted legacy data —
    // the legacy password is never persisted as an app password anywhere.
  });
});
