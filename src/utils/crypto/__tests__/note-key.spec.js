import { describe, expect, it, vi } from 'vitest';
import { createMlKem768 } from 'mlkem';
import {
  provisionNoteKey,
  wrapNoteKeyForRecipient,
  unwrapNoteKey,
} from '@/utils/crypto/note-key';

async function hex(buf) { return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join(''); }

async function makeKeypair() {
  const k = await createMlKem768();
  const [pk, sk] = k.generateKeyPair();
  return { pkHex: await hex(pk), skHex: await hex(sk) };
}

const silentLog = { warn() {} };

describe('note key recipient wrapping', () => {
  it('wraps a note key for a recipient and unwraps with their private key', async () => {
    const owner = await createMlKem768();
    const [ownerPk, ownerSk] = owner.generateKeyPair();
    const noteKeyHex = 'ab'.repeat(32); // 32-byte AES key

    const envelope = await wrapNoteKeyForRecipient(await hex(ownerPk), noteKeyHex);
    const recovered = await unwrapNoteKey(await hex(ownerSk), envelope);

    expect(recovered).toBe(noteKeyHex);
    // serialized envelope round-trips
    expect(typeof envelope).toBe('string');
    expect(JSON.parse(envelope).kemCt).toBeTruthy();
  });
});

describe('provisionNoteKey drift guard + provisioning', () => {
  it('unwraps an existing envelope when noteHasKey is true, without re-provisioning', async () => {
    const identity = await makeKeypair();
    const noteKeyHex = 'ab'.repeat(32);
    const envelope = await wrapNoteKeyForRecipient(identity.pkHex, noteKeyHex);
    const getKey = vi.fn().mockResolvedValue({ noteId: 'n1', wrappedKey: envelope, noteHasKey: true });
    const storeRecipients = vi.fn();

    const result = await provisionNoteKey({
      getKey,
      listPublicKeys: vi.fn(),
      storeRecipients,
      identity: { privateKeyHex: identity.skHex },
      log: silentLog,
    });

    expect(result).toBe(noteKeyHex);
    expect(storeRecipients).not.toHaveBeenCalled();
  });

  it('returns null for a late joiner (noteHasKey true, no envelope), without re-provisioning', async () => {
    const identity = await makeKeypair();
    const getKey = vi.fn().mockResolvedValue({ noteId: 'n1', wrappedKey: null, noteHasKey: true });
    const storeRecipients = vi.fn();

    const result = await provisionNoteKey({
      getKey,
      listPublicKeys: vi.fn(),
      storeRecipients,
      identity: { privateKeyHex: identity.skHex },
      log: silentLog,
    });

    expect(result).toBeNull();
    expect(storeRecipients).not.toHaveBeenCalled();
  });

  it('provisions a fresh note key for keypair\u2019d collaborators and stores recipient envelopes', async () => {
    const identity = await makeKeypair();
    const alice = await makeKeypair();
    const getKey = vi.fn().mockResolvedValue({ noteId: 'n1', wrappedKey: null, noteHasKey: false });
    const listPublicKeys = vi.fn().mockResolvedValue({
      collaborators: [{ userId: 'alice', kemPublicKey: alice.pkHex }],
    });
    const storeRecipients = vi.fn().mockResolvedValue({ stored: 1, existing: false });

    const result = await provisionNoteKey({
      getKey,
      listPublicKeys,
      storeRecipients,
      identity: { privateKeyHex: identity.skHex },
      log: silentLog,
    });

    expect(typeof result).toBe('string');
    expect(result).toMatch(/^[0-9a-f]{64}$/i);
    expect(listPublicKeys).toHaveBeenCalledTimes(1);
    expect(storeRecipients).toHaveBeenCalledTimes(1);
    const [recipients] = storeRecipients.mock.calls[0];
    expect(recipients).toHaveLength(1);
    expect(recipients[0].userId).toBe('alice');
    const recovered = await unwrapNoteKey(alice.skHex, recipients[0].wrappedKey);
    expect(recovered).toBe(result);
  });

  it('returns null for the legacy { noteId, wrappedKey } shape (no noteHasKey), without provisioning', async () => {
    const identity = await makeKeypair();
    const noteKeyHex = 'cd'.repeat(32);
    const envelope = await wrapNoteKeyForRecipient(identity.pkHex, noteKeyHex);
    const getKey = vi.fn().mockResolvedValue({ noteId: 'n1', wrappedKey: envelope });
    const storeRecipients = vi.fn();

    const result = await provisionNoteKey({
      getKey,
      listPublicKeys: vi.fn(),
      storeRecipients,
      identity: { privateKeyHex: identity.skHex },
      log: silentLog,
    });

    expect(result).toBeNull();
    expect(storeRecipients).not.toHaveBeenCalled();
  });

  it('returns null for the legacy { noteId, key } shape, without provisioning', async () => {
    const identity = await makeKeypair();
    const getKey = vi.fn().mockResolvedValue({ noteId: 'n1', key: 'ab'.repeat(32) });
    const storeRecipients = vi.fn();

    const result = await provisionNoteKey({
      getKey,
      listPublicKeys: vi.fn(),
      storeRecipients,
      identity: { privateKeyHex: identity.skHex },
      log: silentLog,
    });

    expect(result).toBeNull();
    expect(storeRecipients).not.toHaveBeenCalled();
  });
});
