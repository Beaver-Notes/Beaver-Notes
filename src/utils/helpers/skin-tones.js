export const SKIN_TONE_SUFFIXES = [
  ': light skin tone',
  ': medium-light skin tone',
  ': medium skin tone',
  ': medium-dark skin tone',
  ': dark skin tone',
];

/**
 * Build a base-name -> skin-tone-variant-emoji map from the emoji dataset.
 */
export function buildSkinToneMap(emojis) {
  const map = {};
  for (const e of emojis) {
    for (const s of SKIN_TONE_SUFFIXES) {
      if (e.name.endsWith(s)) {
        const base = e.name.slice(0, -s.length);
        if (!map[base]) map[base] = [];
        map[base].push(e);
        break;
      }
    }
  }
  return map;
}

export function isSkinToneVariant(name) {
  return SKIN_TONE_SUFFIXES.some((s) => name.endsWith(s));
}
