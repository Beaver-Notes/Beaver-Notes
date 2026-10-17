// src/lib/share/parse.spec.ts
import { describe, expect, it } from 'vitest';
import { createTextContent, extractFirstUrl, guessShareKind } from './parse';

describe('extractFirstUrl', () => {
  it('finds a bare url', () => {
    expect(extractFirstUrl('check this https://example.com/a?b=1 out')).toBe(
      'https://example.com/a?b=1'
    );
  });
  it('returns null when absent', () => {
    expect(extractFirstUrl('no link here')).toBeNull();
  });
});

describe('guessShareKind', () => {
  it('prefers image mime', () => {
    expect(guessShareKind({ mimeType: 'image/png', text: 'https://x.com' })).toBe('image');
  });
  it('uses url when present', () => {
    expect(guessShareKind({ url: 'https://x.com' })).toBe('url');
  });
  it('detects supported file paths', () => {
    expect(guessShareKind({ filePath: '/tmp/a.bea' })).toBe('file');
    expect(guessShareKind({ filePath: '/tmp/a.md' })).toBe('file');
    expect(guessShareKind({ filePath: '/tmp/a.zip' })).toBe('text');
  });
  it('falls back to text', () => {
    expect(guessShareKind({ text: 'hello' })).toBe('text');
  });
});

describe('createTextContent', () => {
  it('makes one paragraph per line', () => {
    const doc = createTextContent('a\nb');
    expect(doc.type).toBe('doc');
    expect(doc.content.map((n: any) => n.type)).toEqual(['paragraph', 'paragraph']);
  });
});
