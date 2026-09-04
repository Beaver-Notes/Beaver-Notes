
const cache = new WeakMap();

/** Sort objects by key, cached on array reference plus key/order. Pinia getters return fresh array on change, so hit is O(1). */
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
