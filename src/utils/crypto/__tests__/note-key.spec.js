import { describe, expect, it } from 'vitest';
import { createMlKem768 } from 'mlkem';

async function hex(buf) { return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join(''); }

describe('note key recipient wrapping', () => {
  it('wraps a note key for a recipient and unwraps with their private key', async () => {
    const { wrapNoteKeyForRecipient, unwrapNoteKey } = await import('@/utils/crypto/note-key');
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
