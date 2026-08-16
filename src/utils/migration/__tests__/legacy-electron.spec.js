import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bufToHex, bufToBase64 } from '@/utils/crypto/codec.js';

const {
  readLegacyDataMock,
  writeLegacyDataMock,
  deriveArgon2KeyMock,
  decryptLegacyCryptoJSMock,
  encryptContentMock,
  decryptContentMock,
} = vi.hoisted(() => {
  // Minimal codec helpers so the faithful encrypt/decrypt pair below does not
  // depend on module imports (vi.hoisted runs before imports resolve).
  const bufToHex = (buf) =>
    Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  const hexToBuf = (hex) =>
    Uint8Array.from(hex.match(/.{2}/g) || [], (b) => parseInt(b, 16));
  const bufToBase64 = (buf) => {
    let binary = '';
    for (const byte of buf) binary += String.fromCharCode(byte);
    return btoa(binary);
  };
  const base64ToBuf = (b64) =>
    Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  // Shared AES-GCM key so the mock pair round-trips like the real native
  // encryption:encryptNotePayload / encryption:decryptNotePayload commands.
  let aesKey = null;
  async function getAesKey() {
    if (!aesKey) {
      aesKey = await crypto.subtle.importKey(
        'raw',
        crypto.getRandomValues(new Uint8Array(32)),
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    }
    return aesKey;
  }

  const encryptContentMock = vi.fn(async (contentObj) => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        await getAesKey(),
        new TextEncoder().encode(JSON.stringify(contentObj))
      )
    );
    return {
      ae: 6,
      iv: bufToHex(iv),
      cipher: bufToBase64(cipher),
      kid: 'test-workspace',
    };
  });

  const decryptContentMock = vi.fn(async (envelope) => {
    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: hexToBuf(envelope.iv) },
        await getAesKey(),
        base64ToBuf(envelope.cipher)
      )
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  });

  return {
    readLegacyDataMock: vi.fn(),
    writeLegacyDataMock: vi.fn(),
    deriveArgon2KeyMock: vi.fn(),
    decryptLegacyCryptoJSMock: vi.fn(),
    encryptContentMock,
    decryptContentMock,
  };
});

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

// Faithful encrypt/decrypt PAIR: encryptContent performs a real AES-GCM
// round trip in-test (Web Crypto is available in happy-dom/node), so the
// ae:6 envelope and the post-unlock `decryptNoteForMemory` success are
// asserted against actual crypto, not a mocked constant.
vi.mock('@/utils/crypto/encryption.js', () => ({
  isEncryptionEnabled: () => true,
  ensureKeyReadyForWrite: async () => true,
  isEncryptedContent: (contentVal) =>
    !!contentVal && typeof contentVal === 'object' && contentVal.ae === 6,
  encryptContent: encryptContentMock,
  decryptContent: decryptContentMock,
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

import { migrateLegacyLockedNotes, validateLegacyLockedPassword } from '../legacyElectron.js';
import { decryptNoteForMemory } from '@/utils/note/serializer.js';

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
    decryptContentMock.mockReset();
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
    // The written note's content is a real workspace-encrypted ae:6 envelope.
    const migratedNote = writtenNotes()[note.id];
    expect(migratedNote.content.ae).toBe(6);
    expect(migratedNote.content.iv).toBeTruthy();
    expect(migratedNote.content.cipher).toBeTruthy();
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
    expect(migratedNote.content.ae).toBe(6);
    expect(migratedNote.content.iv).toBeTruthy();
    expect(migratedNote.content.cipher).toBeTruthy();
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

  it('round-trips: a migrated ae:6 note decrypts back to the original plaintext via decryptNoteForMemory', async () => {
    const note = {
      id: 'n4',
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

    const migratedNote = writtenNotes()[note.id];
    expect(migratedNote.content.ae).toBe(6);
    expect(migratedNote.isLocked).toBe(true);

    // The ae:6 envelope produced by encryptContent must be decryptable by the
    // exact path the app's unlock flow uses (decryptContent → decryptNoteForMemory).
    const decrypted = await decryptNoteForMemory(migratedNote);
    expect(decrypted.content).toStrictEqual(JSON.parse(PLAINTEXT_DOC));
    expect(decrypted.isLocked).toBe(true);
  });
});

describe('validateLegacyLockedPassword (read-only validation)', () => {
  beforeEach(() => {
    readLegacyDataMock.mockReset();
    writeLegacyDataMock.mockReset();
    deriveArgon2KeyMock.mockReset();
    decryptLegacyCryptoJSMock.mockReset();
  });

  it('resolves ok with the locked-note count for a correct password', async () => {
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

    const result = await validateLegacyLockedPassword('/legacy/dir', 'correct-pw');

    expect(result).toEqual({ ok: true, count: 1 });
    expect(decryptLegacyCryptoJSMock).toHaveBeenCalledWith(
      'U2FsdGVkX1+mockCiphertext',
      'correct-pw'
    );
    // Read-only: nothing is ever written back to config.json.
    expect(writeLegacyDataMock).not.toHaveBeenCalled();
  });

  it('throws "Incorrect password" for a wrong password', async () => {
    const note = {
      id: 'n2',
      title: 'Locked legacy note',
      isLocked: true,
      content: { type: 'doc', content: ['U2FsdGVkX1+mockCiphertext'] },
    };
    readLegacyDataMock.mockResolvedValue(
      JSON.stringify({ data: legacyData(note) })
    );
    decryptLegacyCryptoJSMock.mockRejectedValue(new Error('bad password'));

    await expect(
      validateLegacyLockedPassword('/legacy/dir', 'wrong-pw')
    ).rejects.toThrow('Incorrect password');
    expect(writeLegacyDataMock).not.toHaveBeenCalled();
  });

  it('resolves ok with count 0 when no locked notes exist', async () => {
    readLegacyDataMock.mockResolvedValue(
      JSON.stringify({
        data: {
          notes: { n3: { id: 'n3', isLocked: false } },
          lockStatus: {},
          isLocked: {},
        },
      })
    );

    const result = await validateLegacyLockedPassword('/legacy/dir', 'any-pw');

    expect(result).toEqual({ ok: true, count: 0 });
    expect(decryptLegacyCryptoJSMock).not.toHaveBeenCalled();
    expect(writeLegacyDataMock).not.toHaveBeenCalled();
  });
});
