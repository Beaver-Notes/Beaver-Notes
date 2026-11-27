import { describe, expect, it } from 'vitest';
import { isAllowedContentMediaSrc } from './contentSecurity.js';

describe('isAllowedContentMediaSrc (SC-4-02/SC-4-04 shared gate)', () => {
  it.each([
    'assets://note-1/pic.png',
    'file-assets://note-1/doc.pdf',
    'blob:550e8400-e29b-41d4-a716-446655440000',
    'https://example.com/pic.png',
    'HTTPS://EXAMPLE.COM/CLIP.MP4',
    'data:image/png;base64,AAA=',
    'data:image/svg+xml;base64,AAA=',
    'data:video/mp4;base64,AAA=',
    'DATA:VIDEO/WEBM;BASE64,AAA=',
  ])('allows %s', (input) => {
    expect(isAllowedContentMediaSrc(input)).toBe(true);
  });

  it.each([
    'file:///etc/passwd',
    'file://note-1/pic.png',
    'http://example.com/pic.png',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'vbscript:x',
    'data:text/html;base64,PGltZz4=',
    'data:application/pdf;base64,AAA=',
    'data:audio/mp3;base64,AAA=',
    '//evil.example/track.png',
    'sub/pic.png',
    'pic.png',
    '',
    '   ',
    null,
    undefined,
    'https://example.com/a b.png',
    'assets://note-1/a\nb.png',
  ])('refuses %j (dropped with warn, never rendered)', (input) => {
    expect(isAllowedContentMediaSrc(input)).toBe(false);
  });
});
