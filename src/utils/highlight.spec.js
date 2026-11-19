import { describe, it, expect } from 'vitest';
import { highlightSegments } from './highlight.js';

describe('highlightSegments', () => {
  it('returns the whole text as a non-match for an empty query', () => {
    expect(highlightSegments('hello world', '')).toEqual([
      { text: 'hello world', match: false },
    ]);
    expect(highlightSegments('hello', '   ')).toEqual([
      { text: 'hello', match: false },
    ]);
  });

  it('returns the whole text as a non-match when nothing matches', () => {
    expect(highlightSegments('hello', 'xyz')).toEqual([
      { text: 'hello', match: false },
    ]);
  });

  it('is case-insensitive and matches partial words', () => {
    expect(highlightSegments('Meeting notes', 'meet')).toEqual([
      { text: 'Meet', match: true },
      { text: 'ing notes', match: false },
    ]);
  });

  it('highlights every occurrence', () => {
    expect(highlightSegments('note about notes', 'note')).toEqual([
      { text: 'note', match: true },
      { text: ' about ', match: false },
      { text: 'note', match: true },
      { text: 's', match: false },
    ]);
  });

  it('merges overlapping matches from multiple query terms', () => {
    const segments = highlightSegments('домашняя работа', 'дом работа');
    expect(segments.filter((s) => s.match).map((s) => s.text)).toEqual([
      'дом',
      'работа',
    ]);
    expect(segments.map((s) => s.text).join('')).toBe('домашняя работа');
  });

  it('handles undefined text', () => {
    expect(highlightSegments(undefined, 'a')).toEqual([
      { text: '', match: false },
    ]);
  });

  it('reassembles to the original text', () => {
    const text = 'The quick brown fox jumps over the lazy dog';
    const segments = highlightSegments(text, 'quick fox dog');
    expect(segments.map((s) => s.text).join('')).toBe(text);
  });
});
