import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyRemote,
  clearPendingRemote,
  registerActiveDoc,
  unregisterActiveDoc,
} from '@/lib/yjs/shared.js';

afterEach(() => {
  unregisterActiveDoc('n1');
});

// SC-1-05: the pendingRemote buffer holds decrypted note fragments, so it must
// not survive sign-out. Clearing it also stops a later doc registration from
// replaying the previous account's updates.
describe('clearPendingRemote (sign-out teardown)', () => {
  it('drops buffered remote updates and the replay they would trigger', () => {
    // Buffer an update for a note with no active doc.
    const source = new Y.Doc();
    source.getText('t').insert(0, 'plaintext fragment');
    expect(applyRemote('n1', Y.encodeStateAsUpdate(source))).toBe(false);

    clearPendingRemote();

    // A doc registered afterwards must NOT receive the buffered plaintext.
    const doc = new Y.Doc();
    registerActiveDoc('n1', doc);
    expect(doc.getText('t').toString()).toBe('');
  });
});

