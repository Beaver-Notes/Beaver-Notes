import { describe, expect, it } from 'vitest';
import { noteSearchText } from './note-search-text.js';

const content = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'hello world' }] },
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'title here' }] },
    { type: 'codeBlock', content: [{ type: 'text', text: 'const x = 1' }] },
  ],
};

describe('noteSearchText', () => {
  it('uses the precomputed searchText when present', () => {
    expect(noteSearchText({ searchText: 'already flat' })).toBe('already flat');
  });

  it('falls back to extracting flat text from content', () => {
    expect(noteSearchText({ content })).toBe('hello world title here const x = 1');
  });

  it('returns empty string when nothing is available', () => {
    expect(noteSearchText({})).toBe('');
  });

  it('prefers searchText over content', () => {
    expect(noteSearchText({ searchText: 'flat', content })).toBe('flat');
  });
});
