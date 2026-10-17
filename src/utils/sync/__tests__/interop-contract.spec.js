import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';

const TITLE = 'Contract title ✓ unicode — naïve café';
const fixtures = 'src/utils/sync/__tests__/fixtures/';

function loadFixture(name) {
  const b64 = readFileSync(fixtures + name, 'utf8').trim();
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

describe('yrs interop contract', () => {
  test('yjs applies a yrs-generated update with zero loss', () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, loadFixture('yrs_update.b64'));

    expect(doc.getText('title').toString()).toBe(TITLE);
    expect(doc.getMap('meta').get('author')).toBe('rust-side');
    expect(doc.getXmlFragment('content').toString()).toContain('Hello interop');
  });

  test('yjs re-emits the yrs doc deterministically', () => {
    const a = new Y.Doc();
    Y.applyUpdate(a, loadFixture('yrs_update.b64'));
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    expect(b.getText('title').toString()).toBe(TITLE);
    expect(Y.encodeStateAsUpdate(b)).toEqual(Y.encodeStateAsUpdate(a));
  });
});
