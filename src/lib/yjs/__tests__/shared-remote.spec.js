import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyRemote,
  onRemoteApplied,
  registerActiveDoc,
  unregisterActiveDoc,
} from '@/lib/yjs/shared.js';

afterEach(() => {
  unregisterActiveDoc('n1');
});

describe('applyRemote listener', () => {
  it('notifies only when a remote update actually changes the doc', () => {
    const docA = new Y.Doc();
    docA.getText('t').insert(0, 'hello');
    registerActiveDoc('n1', docA);

    const seen = [];
    const off = onRemoteApplied((id) => seen.push(id));

    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    docB.getText('t').insert(5, ' world');
    const remoteUpdate = Y.encodeStateAsUpdate(docB);

    expect(applyRemote('n1', remoteUpdate)).toBe(true);
    expect(seen).toEqual(['n1']);
    expect(docA.getText('t').toString()).toBe('hello world');

    // Re-applying the same update is a no-op: no banner.
    applyRemote('n1', remoteUpdate);
    expect(seen).toEqual(['n1']);

    // Local edits never notify.
    docA.getText('t').insert(0, 'X');
    expect(seen).toEqual(['n1']);

    // Unknown note: nothing to apply, no notification.
    expect(applyRemote('missing', remoteUpdate)).toBe(false);
    expect(seen).toEqual(['n1']);

    off();
  });

  it('notifies for remote deletions too', () => {
    const docA = new Y.Doc();
    docA.getText('t').insert(0, 'hello world');
    registerActiveDoc('n1', docA);

    const seen = [];
    const off = onRemoteApplied((id) => seen.push(id));

    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    docB.getText('t').delete(0, 6);
    applyRemote('n1', Y.encodeStateAsUpdate(docB));

    expect(docA.getText('t').toString()).toBe('world');
    expect(seen).toEqual(['n1']);

    off();
  });
});
