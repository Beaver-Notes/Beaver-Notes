import { describe, it, expect, vi, beforeEach } from 'vitest';

const appendBatch = vi.fn(async () => {});
const decryptNoteWithPassword = vi.fn();
const decryptContent = vi.fn();
const isAppEncryptedEnvelope = vi.fn();
vi.mock('@/utils/migration/legacyElectron.js', () => ({ decryptNoteWithPassword }));
vi.mock('@/lib/native/yjs.js', () => ({ appendBatch }));
vi.mock('@/lib/yjs/helpers.js', () => ({
  ensureSchema: vi.fn(async () => ({})),
  getDeviceId: vi.fn(() => 'device-1'),
}));
vi.mock('@/utils/crypto/encryption.js', () => ({
  decryptContent,
  isAppEncryptedEnvelope,
}));
vi.mock('@tiptap/y-tiptap', () => ({
  prosemirrorJSONToYDoc: vi.fn(() => ({
    getXmlFragment: () => ({ length: 1 }),
  })),
}));
vi.mock('yjs', () => ({
  encodeStateAsUpdate: vi.fn(() => new Uint8Array([1, 2, 3])),
}));

const { convertLegacyNotesToYjs } = await import('../legacyContentToYjs.js');

describe('convertLegacyNotesToYjs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('converts plaintext ProseMirror notes and batches them into Yjs', async () => {
    const notes = [
      { id: 'n1', content: { type: 'doc', content: [] }, title: 'One' },
      { id: 'n2', content: { type: 'doc', content: [] }, title: 'Two' },
      { id: 'n3', content: { type: 'doc', content: [] }, title: 'Three' },
    ];
    const result = await convertLegacyNotesToYjs(notes);
    expect(result.converted).toBe(3);
    expect(result.skipped).toBe(0);
    expect(appendBatch).toHaveBeenCalledWith(
      ['n1', 'n2', 'n3'],
      [expect.any(Uint8Array), expect.any(Uint8Array), expect.any(Uint8Array)],
      ['device-1', 'device-1', 'device-1']
    );
  });

  it('skips notes without content or without an id', async () => {
    const notes = [
      { id: 'n1' },
      { content: { type: 'doc', content: [] } },
      { id: 'n2', content: { type: 'doc', content: [] } },
    ];
    const result = await convertLegacyNotesToYjs(notes);
    expect(result.converted).toBe(1);
    expect(result.skipped).toBe(2);
  });

  it('reports per-note failures without aborting the batch', async () => {
    const { prosemirrorJSONToYDoc } = await import('@tiptap/y-tiptap');
    prosemirrorJSONToYDoc.mockImplementationOnce(() => {
      throw new Error('schema mismatch');
    });
    const notes = [{ id: 'n1', content: { type: 'doc', content: [] } }];
    const result = await convertLegacyNotesToYjs(notes);
    expect(result.converted).toBe(0);
    expect(result.failures).toEqual(['n1']);
  });

  it('decrypts locked notes with the provided legacy password before converting', async () => {
    decryptNoteWithPassword.mockResolvedValue({ plaintext: '{"type":"doc","content":[]}' });
    const notes = [{ id: 'locked-1', isLocked: true, content: { type: 'doc', content: ['{"v":2,"salt":"s","iv":"i","cipher":"c"}'] } }];
    const result = await convertLegacyNotesToYjs(notes, { legacyPassword: 'pw' });
    expect(result.converted).toBe(1);
    expect(decryptNoteWithPassword).toHaveBeenCalled();
  });

  it('skips locked notes when no legacy password is provided', async () => {
    const notes = [{ id: 'locked-2', isLocked: true, content: { type: 'doc', content: ['{"v":2,"salt":"s","iv":"i","cipher":"c"}'] } }];
    const result = await convertLegacyNotesToYjs(notes);
    expect(result.converted).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('decrypts an app-encrypted ae:6 locked note with the workspace key via decryptContent', async () => {
    decryptContent.mockResolvedValue({ type: 'doc', content: [] });
    isAppEncryptedEnvelope.mockReturnValue(true);
    const envelope = { ae: 6, iv: 'iv', cipher: 'cipher', kid: 'ws' };
    const notes = [{ id: 'ae-1', isLocked: true, content: envelope }];
    const result = await convertLegacyNotesToYjs(notes, { legacyPassword: 'pw' });
    expect(isAppEncryptedEnvelope).toHaveBeenCalledWith(envelope);
    expect(decryptContent).toHaveBeenCalledWith(envelope);
    expect(decryptNoteWithPassword).not.toHaveBeenCalled();
    expect(result.converted).toBe(1);
    expect(result.failures).toEqual([]);
  });

  it('decrypts an app-encrypted ae:6 locked note even without a legacy password', async () => {
    decryptContent.mockResolvedValue({ type: 'doc', content: [] });
    isAppEncryptedEnvelope.mockReturnValue(true);
    const envelope = { ae: 6, iv: 'iv', cipher: 'cipher', kid: 'ws' };
    const notes = [{ id: 'ae-2', isLocked: true, content: envelope }];
    const result = await convertLegacyNotesToYjs(notes);
    expect(isAppEncryptedEnvelope).toHaveBeenCalledWith(envelope);
    expect(decryptContent).toHaveBeenCalledWith(envelope);
    expect(decryptNoteWithPassword).not.toHaveBeenCalled();
    expect(result.converted).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('skips notes already converted in a prior run (alreadyConvertedIds)', async () => {
    const notes = [
      { id: 'n1', content: { type: 'doc', content: [] } },
      { id: 'n2', content: { type: 'doc', content: [] } },
    ];
    const result = await convertLegacyNotesToYjs(notes, {
      alreadyConvertedIds: new Set(['n1']),
    });
    expect(result.skipped).toBe(1);
    expect(result.converted).toBe(1);
    expect(appendBatch).toHaveBeenCalledWith(
      ['n2'],
      [expect.any(Uint8Array)],
      ['device-1']
    );
  });
});
