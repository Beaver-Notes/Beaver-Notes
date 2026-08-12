import { describe, expect, it } from 'vitest';
import {
  SKIN_TONE_SUFFIXES,
  buildSkinToneMap,
  isSkinToneVariant,
} from './skin-tones.js';

describe('skin tone helpers', () => {
  it('builds a base-name to variant map', () => {
    const emojis = [
      { name: 'thumbs up', char: '👍' },
      { name: `thumbs up${SKIN_TONE_SUFFIXES[0]}`, char: '👍🏻' },
      { name: `thumbs up${SKIN_TONE_SUFFIXES[1]}`, char: '👍🏼' },
      { name: 'wave', char: '👋' },
    ];
    const map = buildSkinToneMap(emojis);
    expect(map['thumbs up']).toHaveLength(2);
    expect(map['wave']).toBeUndefined();
  });

  it('recognizes skin tone variants', () => {
    expect(isSkinToneVariant(`wave${SKIN_TONE_SUFFIXES[4]}`)).toBe(true);
    expect(isSkinToneVariant('wave')).toBe(false);
  });

  it('handles empty input', () => {
    expect(buildSkinToneMap([])).toEqual({});
  });
});
