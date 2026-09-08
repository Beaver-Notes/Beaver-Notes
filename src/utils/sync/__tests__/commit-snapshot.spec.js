import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';

vi.mock('@/lib/yjs/shared.js', () => ({
  getActiveDoc: vi.fn(),
}));

describe('captureNoteSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no active doc exists', async () => {
    const { getActiveDoc } = await import('@/lib/yjs/shared.js');
    getActiveDoc.mockReturnValue(null);

    const { captureNoteSnapshot } = await import('../commit-snapshot.js');
    const result = await captureNoteSnapshot('note-1');
    expect(result).toBeNull();
  });

  it('returns null when doc has empty content and title', async () => {
    const { getActiveDoc } = await import('@/lib/yjs/shared.js');
    const doc = new Y.Doc();
    getActiveDoc.mockReturnValue(doc);

    const { captureNoteSnapshot } = await import('../commit-snapshot.js');
    const result = await captureNoteSnapshot('note-1');
    expect(result).toBeNull();
    doc.destroy();
  });

  it('captures title from the Yjs doc', async () => {
    const { getActiveDoc } = await import('@/lib/yjs/shared.js');
    const doc = new Y.Doc();
    getActiveDoc.mockReturnValue(doc);

    // Seed title
    const titleFrag = doc.getXmlFragment('title');
    doc.transact(() => {
      const text = new Y.XmlText();
      text.insert(0, 'My Note Title');
      titleFrag.push([text]);
    });

    const { captureNoteSnapshot } = await import('../commit-snapshot.js');
    const result = await captureNoteSnapshot('note-1');
    expect(result).not.toBeNull();
    expect(result.title).toContain('My Note Title');
    doc.destroy();
  });
});

describe('captureNoteSnapshotFromBytes', () => {
  it('round-trips content+title through full-state bytes', async () => {
    const { captureNoteSnapshotFromBytes } = await import('../commit-snapshot.js');
    const src = new Y.Doc();
    src.getText('title').insert(0, 'Bytes Title');
    const bytes = Y.encodeStateAsUpdate(src);
    src.destroy();

    const result = await captureNoteSnapshotFromBytes('note-1', bytes);
    expect(result).not.toBeNull();
    expect(result.title).toContain('Bytes Title');
  });

  it('returns null for empty/corrupt bytes', async () => {
    const { captureNoteSnapshotFromBytes } = await import('../commit-snapshot.js');
    expect(await captureNoteSnapshotFromBytes('n', new Uint8Array(0))).toBeNull();
    expect(await captureNoteSnapshotFromBytes('n', new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('isEncryptedEnvelopeBytes', () => {
  it('detects v4/v5 envelopes, passes through binary', async () => {
    const { isEncryptedEnvelopeBytes } = await import('../crypto.js');
    const enc = (s) => new TextEncoder().encode(s);
    expect(isEncryptedEnvelopeBytes(enc('{"v":5,"meta":{}}'))).toBe(true);
    expect(isEncryptedEnvelopeBytes(enc('{"v":4,"meta":{}}'))).toBe(true);
    expect(isEncryptedEnvelopeBytes(enc('{"foo":1}'))).toBe(false);
    expect(isEncryptedEnvelopeBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(isEncryptedEnvelopeBytes(new Uint8Array(0))).toBe(false);
  });
});
