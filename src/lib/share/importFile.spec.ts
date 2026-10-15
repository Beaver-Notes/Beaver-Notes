// src/lib/share/importFile.spec.ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/markdown', () => ({ convertMarkdownToTiptap: vi.fn() }));
vi.mock('./htmlToTiptap', () => ({ htmlToTiptap: vi.fn() }));

import { importSharedFile } from './importFile';

describe('importSharedFile', () => {
  it('imports .txt as plain paragraphs', async () => {
    const bytes = new TextEncoder().encode('hello\nworld');
    const r = await importSharedFile({ fileName: 'a.txt', data: bytes });
    expect(r.title).toBe('');
    expect((r.content as any).content[0].content[0].text).toBe('hello');
  });
  it('imports .bea payloads written by exportBEA', async () => {
    const bea = {
      data: {
        id: 'n1',
        title: 'T',
        content: { type: 'doc', content: [] },
        isLocked: false,
        assets: { notesAssets: { 'a.png': 'AAA=' }, fileAssets: {} },
        labels: [],
      },
    };
    const r = await importSharedFile({
      fileName: 'a.bea',
      data: new TextEncoder().encode(JSON.stringify(bea)),
    });
    expect(r.title).toBe('T');
    expect((r.content as any).type).toBe('doc');
  });
  it('still imports flat .bea payloads', async () => {
    const note = { title: 'T', content: { type: 'doc', content: [] }, createdAt: 1 };
    const r = await importSharedFile({
      fileName: 'a.bea',
      data: new TextEncoder().encode(JSON.stringify(note)),
    });
    expect(r.title).toBe('T');
    expect((r.content as any).type).toBe('doc');
  });
  it('rejects .bea payloads with no doc content', async () => {
    const bea = { data: { id: 'n1', title: 'T', content: { type: 'paragraph' } } };
    await expect(
      importSharedFile({
        fileName: 'a.bea',
        data: new TextEncoder().encode(JSON.stringify(bea)),
      })
    ).rejects.toThrow('Invalid .bea payload');
  });
  it('rejects unsupported extensions', async () => {
    await expect(
      importSharedFile({ fileName: 'a.exe', data: new Uint8Array() })
    ).rejects.toThrow(/Unsupported/);
  });
});
