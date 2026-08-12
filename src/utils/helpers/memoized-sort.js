// ─── Memoized array sort ──────────────────────────────────────────────────────

const cache = new WeakMap();

/**
 * Sort an array of objects by a key, avoiding the O(n log n) sort on cache hits.
 *
 * The cache is keyed on the array *reference* + (key, order). Callers pass
 * Pinia getters (e.g. `noteStore.notes`), which return a fresh array whenever
 * any note changes — so the reference change is the mutation signal and a hit
 * is O(1), with no signature string to build and no per-hit array rebuild.
 * The sorted output shares the same element references as the input, so it is
 * never stale.
 *
 * Re-sorts only when a new array reference is passed or key/order change.
 */
export function memoizedSort({ data, key, order = 'asc' }) {
  if (!Array.isArray(data)) return data;

  const cacheKey = `${key}:${order}`;
  const entry = cache.get(data);
  if (entry !== undefined && entry.cacheKey === cacheKey) {
    return entry.items;
  }

  const sorted = data.slice().sort((a, b) => {
    const varA = a[key];
    const varB = b[key];

    if (varA == null && varB == null) return 0;
    if (varA == null) return 1;
    if (varB == null) return -1;

    let comparison = 0;
    if (typeof varA === 'string') {
      comparison = varA.localeCompare(varB);
    } else {
      comparison = varA > varB ? 1 : varA < varB ? -1 : 0;
    }

    return order === 'desc' ? -comparison : comparison;
  });

  cache.set(data, { cacheKey, items: sorted });
  return sorted;
}
