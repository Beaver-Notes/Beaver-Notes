/**
 * Split text into segments, marking the parts that match a search query.
 * Matching is case-insensitive and works on partial words. The query is
 * split into whitespace-separated terms; every occurrence of every term is
 * highlighted. Overlapping ranges are merged.
 *
 * @param {string} text
 * @param {string} query
 * @returns {Array<{text: string, match: boolean}>}
 */
export function highlightSegments(text, query) {
  const value = String(text ?? '');
  const terms = String(query ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!value || terms.length === 0) {
    return [{ text: value, match: false }];
  }

  const ranges = [];
  const lower = value.toLocaleLowerCase();
  for (const term of terms) {
    const needle = term.toLocaleLowerCase();
    let from = 0;
    while (from <= lower.length - needle.length) {
      const idx = lower.indexOf(needle, from);
      if (idx === -1) break;
      ranges.push([idx, idx + needle.length]);
      from = idx + 1;
    }
  }

  if (!ranges.length) {
    return [{ text: value, match: false }];
  }

  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    if (ranges[i][0] <= last[1]) {
      last[1] = Math.max(last[1], ranges[i][1]);
    } else {
      merged.push(ranges[i]);
    }
  }

  const segments = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) segments.push({ text: value.slice(cursor, start), match: false });
    segments.push({ text: value.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < value.length) segments.push({ text: value.slice(cursor), match: false });
  return segments;
}
