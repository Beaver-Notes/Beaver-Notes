// src/lib/share/extractContent.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokeCommand = vi.fn();

vi.mock('@/lib/tauri/commands.js', () => ({
  invokeCommand: (...args: unknown[]) => invokeCommand(...args),
}));

// Controllable Defuddle double: per-test parseAsync result.
let parseResult: any = null;
let parseThrows = false;
class FakeDefuddle {
  constructor(_doc: unknown, _opts: unknown) {}
  async parseAsync() {
    if (parseThrows) throw new Error('no content');
    return parseResult;
  }
}
vi.mock('defuddle/full', () => ({ default: FakeDefuddle }));

const convertMarkdownToTiptap = vi.fn();
vi.mock('@/utils/markdown.js', () => ({
  convertMarkdownToTiptap: (...args: unknown[]) => convertMarkdownToTiptap(...args),
}));

import { extractFromUrl, extractedToNote, absolutizeMarkdownUrls, youtubeEmbedId } from './extractContent';

const PAGE = 'https://example.com/post';

beforeEach(() => {
  vi.clearAllMocks();
  parseThrows = false;
  parseResult = {
    title: 'Example Post',
    content: '<article><img src="/i.png"><a href="rel">x</a></article>',
    contentMarkdown: '![a](/i.png)\n\n[rel](rel)\n\n[abs](https://x.io/y)',
  };
  invokeCommand.mockResolvedValue('<html><body><article>hello</article></body></html>');
  convertMarkdownToTiptap.mockImplementation(async (md: string) => ({ title: 'Importer Title', content: { md } }));
});

describe('extractFromUrl', () => {
  it('returns title, absolutized html + markdown, and text in one pass', async () => {
    const out = await extractFromUrl(PAGE);
    expect(invokeCommand).toHaveBeenCalledWith('fetch_page_html', { url: PAGE });
    expect(out.title).toBe('Example Post');
    expect(out.contentHtml).toContain('src="https://example.com/i.png"');
    expect(out.contentHtml).toContain('href="https://example.com/rel"');
    expect(out.markdown).toContain('![a](https://example.com/i.png)');
    expect(out.markdown).toContain('[rel](https://example.com/rel)');
    expect(out.markdown).toContain('[abs](https://x.io/y)');
    expect(out.textContent).toContain('hello');
  });

  it('returns empty on fetch failure', async () => {
    invokeCommand.mockRejectedValue(new Error('offline'));
    expect(await extractFromUrl(PAGE)).toEqual({ title: '', contentHtml: '', markdown: '', textContent: '' });
  });

  it('returns empty when Defuddle throws', async () => {
    parseThrows = true;
    expect(await extractFromUrl(PAGE)).toEqual({ title: '', contentHtml: '', markdown: '', textContent: '' });
  });
});

describe('extractedToNote', () => {
  it('prepends the title as H1 for the importer H1→title lift', async () => {
    const out = await extractedToNote({ title: 'T', markdown: 'body text' });
    const composed = convertMarkdownToTiptap.mock.calls[0][0] as string;
    expect(composed.startsWith('# T\n\n')).toBe(true);
    expect(out.title).toBe('Importer Title');
    expect(out.content).toEqual({ md: composed });
  });

  it('skips the prepend when markdown already opens with a heading', async () => {
    await extractedToNote({ title: 'T', markdown: '# Own head\n\nbody' });
    expect(convertMarkdownToTiptap.mock.calls[0][0]).toBe('# Own head\n\nbody');
  });

  it('falls back to the Defuddle title when the importer yields none', async () => {
    convertMarkdownToTiptap.mockResolvedValueOnce({ title: '', content: {} });
    const out = await extractedToNote({ title: 'T', markdown: 'body' });
    expect(out.title).toBe('T');
  });

  it('prepends a Video node when the shared URL is a YouTube link', async () => {
    convertMarkdownToTiptap.mockResolvedValueOnce({
      title: 'Vid',
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    });
    const out = await extractedToNote(
      { title: 'Vid', markdown: 'transcript…' },
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );
    const blocks = (out.content as any).content;
    expect(blocks[0]).toEqual({
      type: 'Video',
      attrs: { src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', fileName: 'Vid' },
    });
  });

  it('adds no Video node for non-YouTube URLs', async () => {
    convertMarkdownToTiptap.mockResolvedValueOnce({
      title: 'Post',
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    });
    const out = await extractedToNote({ title: 'Post', markdown: 'body' }, PAGE);
    expect((out.content as any).content).toEqual([{ type: 'paragraph' }]);
  });
});

describe('youtubeEmbedId', () => {
  it('extracts ids from watch, youtu.be, shorts, embed and live URLs', () => {
    expect(youtubeEmbedId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeEmbedId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeEmbedId('https://www.youtube.com/shorts/dQw4w9WgXcQ?x=1')).toBe('dQw4w9WgXcQ');
    expect(youtubeEmbedId('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeEmbedId('https://example.com/not-a-video')).toBeNull();
    expect(youtubeEmbedId('')).toBeNull();
  });
});

describe('absolutizeMarkdownUrls', () => {  it('leaves absolute, data:, anchor and mailto destinations alone', () => {
    const md = '[a](https://x.io) ![b](data:image/png;base64,1) [c](#frag) [d](mailto:e@x.io)';
    expect(absolutizeMarkdownUrls(md, PAGE)).toBe(md);
  });
});
