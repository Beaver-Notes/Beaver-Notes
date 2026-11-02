import { describe, expect, it } from 'vitest';
import {
  isSafeOpenUrl,
  sanitizeFileSource,
  sanitizeImageSource,
  sanitizeMediaSource,
  sanitizeNoteContent,
} from './contentSecurity.js';

describe('sanitizeImageSource scheme matrix (SC-4-02/SC-4-04)', () => {
  it.each([
    ['assets://note-1/pic.png', 'assets://note-1/pic.png'],
    ['file-assets://note-1/pic.png', 'file-assets://note-1/pic.png'],
    ['resource://abc123', 'resource://abc123'],
    ['blob:550e8400', 'blob:550e8400'],
    ['data:image/png;base64,AAA=', 'data:image/png;base64,AAA='],
    ['data:image/svg+xml;base64,AAA=', 'data:image/svg+xml;base64,AAA='],
    ['https://example.com/pic.png', 'https://example.com/pic.png'],
  ])('allows legit image source %s', (input, expected) => {
    expect(sanitizeImageSource(input)).toBe(expected);
  });

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'vbscript:x',
    'data:text/html;base64,PGltZz4=',
    'data:application/pdf;base64,AAA=',
    'smb://host/share',
    '//evil.example/track.png',
  ])('rejects unsafe image source %s', (input) => {
    expect(sanitizeImageSource(input)).toBe('');
  });

  it('still allows relative sources only behind allowRelative', () => {
    expect(sanitizeImageSource('sub/pic.png')).toBe('');
    expect(sanitizeImageSource('sub/pic.png', { allowRelative: true })).toBe(
      'sub/pic.png'
    );
  });
});

describe('sanitizeMediaSource scheme matrix (SC-4-02)', () => {
  it.each([
    ['assets://note-1/clip.mp4', 'assets://note-1/clip.mp4'],
    ['file-assets://note-1/clip.mp4', 'file-assets://note-1/clip.mp4'],
    ['blob:550e8400', 'blob:550e8400'],
    ['https://example.com/clip.mp4', 'https://example.com/clip.mp4'],
  ])('allows legit media source %s', (input, expected) => {
    expect(sanitizeMediaSource(input)).toBe(expected);
  });

  it.each([
    'file:///C:/x.mp4',
    'javascript:alert(1)',
    'data:video/mp4;base64,AAA=',
    '//evil.example/clip.mp4',
  ])('rejects unsafe media source %s', (input) => {
    expect(sanitizeMediaSource(input)).toBe('');
  });
});

describe('sanitizeFileSource scheme matrix (fileEmbed, SC-4-02)', () => {
  it.each([
    ['assets://note-1/doc.pdf', 'assets://note-1/doc.pdf'],
    ['file-assets://note-1/doc.pdf', 'file-assets://note-1/doc.pdf'],
    ['resource://abc123', 'resource://abc123'],
    ['blob:550e8400', 'blob:550e8400'],
    // Share-import legitimately embeds arbitrary mimes as data: URLs.
    ['data:application/pdf;base64,AAA=', 'data:application/pdf;base64,AAA='],
    ['data:image/png;base64,AAA=', 'data:image/png;base64,AAA='],
    ['https://example.com/doc.pdf', 'https://example.com/doc.pdf'],
  ])('allows legit file source %s', (input, expected) => {
    expect(sanitizeFileSource(input)).toBe(expected);
  });

  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'smb://host/share'])(
    'rejects unsafe file source %s',
    (input) => {
      expect(sanitizeFileSource(input)).toBe('');
    }
  );
});

describe('isSafeOpenUrl (SC-4-08 window.open gate)', () => {
  it.each([
    'https://example.com/page',
    'http://example.com/page',
    'mailto:someone@example.com',
  ])('allows opener-safe url %s', (input) => {
    expect(isSafeOpenUrl(input)).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,hi',
    'note://some-note-id',
    'vbscript:x',
    '/relative/path',
    '',
    'not a url',
  ])('rejects opener-unsafe url %s', (input) => {
    expect(isSafeOpenUrl(input)).toBe(false);
  });
});

describe('sanitizeNoteContent media fallback (SC-4-02/SC-4-04 path)', () => {
  const doc = (nodes) => ({ type: 'doc', content: nodes });

  it('replaces an image with an unsafe src by a text fallback', () => {
    const out = sanitizeNoteContent(
      doc([
        {
          type: 'image',
          attrs: { src: 'file:///etc/passwd', alt: 'x' },
        },
      ])
    );
    expect(out.content[0].type).toBe('paragraph');
    expect(out.content[0].content[0].text).toContain('file://');
  });

  it('keeps legit local-asset and https image srcs untouched', () => {
    const out = sanitizeNoteContent(
      doc([
        { type: 'image', attrs: { src: 'assets://n1/a.png', alt: 'a' } },
        {
          type: 'image',
          attrs: { src: 'https://example.com/b.png', alt: 'b' },
        },
        {
          type: 'image',
          attrs: { src: 'data:image/png;base64,AAA=', alt: 'c' },
        },
      ])
    );
    expect(out.content.map((n) => n.attrs.src)).toEqual([
      'assets://n1/a.png',
      'https://example.com/b.png',
      'data:image/png;base64,AAA=',
    ]);
  });

  it('replaces Video/Audio nodes with unsafe srcs by fallback text', () => {
    const out = sanitizeNoteContent(
      doc([
        { type: 'Video', attrs: { src: 'file:///C:/x.mp4' } },
        { type: 'Audio', attrs: { src: 'assets://n1/a.mp3' } },
      ])
    );
    expect(out.content[0].type).toBe('paragraph');
    expect(out.content[0].content[0].text).toContain('video');
    expect(out.content[1].type).toBe('Audio');
    expect(out.content[1].attrs.src).toBe('assets://n1/a.mp3');
  });

  it('leaves fileEmbed nodes untouched (share flow data: srcs)', () => {
    const node = {
      type: 'fileEmbed',
      attrs: { src: 'data:application/pdf;base64,AAA=', fileName: 'b.pdf' },
    };
    const out = sanitizeNoteContent(doc([node]));
    expect(out.content[0].attrs.src).toBe(
      'data:application/pdf;base64,AAA='
    );
  });
});
