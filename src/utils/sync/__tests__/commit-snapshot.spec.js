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
