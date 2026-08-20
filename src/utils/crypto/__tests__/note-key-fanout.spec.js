import { describe, it, expect } from 'vitest';
import {
  provisionNoteKey,
  wrapNoteKeyForRecipient,
  unwrapNoteKey,
} from '@/utils/crypto/note-key';
import { generateIdentity } from '@/utils/crypto/identity';

const silentLog = { warn() {} };

describe('provisionNoteKey fan-out', () => {
  it('wraps the note key for every device key and stores per-deviceId', async () => {
    // deviceA is the owner's device ('da'); its private key must unwrap its own envelope.
    const deviceA = await generateIdentity();
    const deviceB = await generateIdentity();

    const identity = {
      publicKeyHex: deviceA.publicKeyHex,
      privateKeyHex: deviceA.privateKeyHex,
    };

    const recipients = [];
    const noteKeyHex = await provisionNoteKey({
      getKey: async () => ({ noteHasKey: false }),
      listPublicKeys: async () => ({
        collaborators: [
          { userId: 'u1', deviceId: 'da', kemPublicKey: deviceA.publicKeyHex },
          { userId: 'u1', deviceId: 'db', kemPublicKey: deviceB.publicKeyHex },
        ],
      }),
      storeRecipients: async (rs) => {
        recipients.push(...rs);
        return { existing: false };
      },
      identity,
      noteId: 'n1',
      log: silentLog,
    });

    expect(noteKeyHex).toMatch(/^[0-9a-f]{64}$/i);
    expect(recipients).toHaveLength(2);
    expect(recipients.map((r) => r.deviceId).sort()).toEqual(['da', 'db']);

    // the owner's own device can unwrap its envelope back to the note key
    const mine = recipients.find((r) => r.deviceId === 'da');
    expect(typeof mine.wrappedKey).toBe('string');
    const unwrapped = await unwrapNoteKey(identity.privateKeyHex, mine.wrappedKey);
    expect(unwrapped).toBe(noteKeyHex);
  });
});
