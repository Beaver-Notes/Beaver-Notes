import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  deterministicClientId,
  seedDeterministically,
} from '@/lib/yjs/helpers.js';

describe('deterministicClientId', () => {
  it('is stable, non-zero and seed-dependent', () => {
    expect(deterministicClientId('note:1')).toBe(
      deterministicClientId('note:1'),
    );
    expect(deterministicClientId('note:1')).not.toBe(0);
    expect(deterministicClientId('a')).not.toBe(deterministicClientId('b'));
  });
});

describe('seedDeterministically', () => {
  it('dedupes identical concurrent seeds instead of concatenating', () => {
    const build = (doc) => doc.getText('title').insert(0, 'hello');
    const a = new Y.Doc();
    const b = new Y.Doc();

    seedDeterministically(a, 'n1:legacy-title', build);
    seedDeterministically(b, 'n1:legacy-title', build);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    expect(a.getText('title').toString()).toBe('hello');
    expect(b.getText('title').toString()).toBe('hello');
  });

  it('merges seeds with different keys as separate edits', () => {
    const doc = new Y.Doc();
    seedDeterministically(doc, 'n1:content', (d) =>
      d.getText('t').insert(0, 'A'),
    );
    seedDeterministically(doc, 'n2:content', (d) =>
      d.getText('t').insert(0, 'B'),
    );

    const text = doc.getText('t').toString();
    expect(text).toHaveLength(2);
    expect(text).toContain('A');
    expect(text).toContain('B');
  });
});
