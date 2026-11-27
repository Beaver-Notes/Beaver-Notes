// Shared emoji.json access for the picker and the customize dialog's
// name-based suggestions. One module-level cache: the ~900 KB dataset is
// fetched and deduped once per session no matter how many consumers ask.
// Callers load lazily so nothing downloads until the picker opens or the
// customize dialog actually needs suggestions.
import { buildSkinToneMap, isSkinToneVariant } from '@/utils/helpers/skin-tones.js';

let datasetCache = null;

export function loadEmojiDataset() {
  if (!datasetCache) {
    datasetCache = import('emoji.json').then((mod) => {
      const data = mod.default || mod;
      const seen = new Set();
      const base = [];
      for (const emoji of data) {
        if (isSkinToneVariant(emoji.name)) continue;
        const normalized = emoji.char.normalize('NFC').replace(/️/g, '');
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        base.push(emoji);
      }
      return { base, skinToneMap: buildSkinToneMap(data) };
    });
  }
  return datasetCache;
}

export function normalizeEmojiText(text) {
  return (text || '').normalize('NFC').replace(/️/g, '').toLowerCase();
}

/**
 * Keep emojis whose name/group/subgroup contain every whitespace token of
 * `query` (emoji-mart style AND-search). Returns [] for an empty query.
 */
export function filterEmojisByQuery(emojis, query, limit = Infinity) {
  const tokens = normalizeEmojiText(query).trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const out = [];
  for (const emoji of emojis) {
    const haystack = normalizeEmojiText(
      `${emoji.name} ${emoji.group || ''} ${emoji.subgroup || ''}`,
    );
    if (tokens.every((token) => haystack.includes(token))) {
      out.push(emoji);
      if (out.length >= limit) break;
    }
  }
  return out;
}
