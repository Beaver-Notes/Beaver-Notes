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
  it('imports .bea payloads', async () => {
    const note = { title: 'T', content: { type: 'doc', content: [] }, createdAt: 1 };
    const r = await importSharedFile({
      fileName: 'a.bea',
      data: new TextEncoder().encode(JSON.stringify(note)),
    });
    expect(r.title).toBe('T');
    expect((r.content as any).type).toBe('doc');
  });
  it('rejects unsupported extensions', async () => {
    await expect(
      importSharedFile({ fileName: 'a.exe', data: new Uint8Array() })
    ).rejects.toThrow(/Unsupported/);
  });
});
