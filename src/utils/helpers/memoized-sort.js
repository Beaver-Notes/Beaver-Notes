// ─── Memoized array sort ──────────────────────────────────────────────────────

let cacheSignature = null;
let cacheOrder = null;

/**
 * Sort an array of objects by a key, avoiding the O(n log n) sort when the
 * resulting order is unchanged.
 *
 * The cache stores the previous *order* (a list of ids) plus the sorted items.
 * On each call:
 *  - if the sort signature matches, the previously computed order is reused
 *    and the items array is rebuilt from the *current* objects — so consumers
 *    never receive stale note objects, only a cheaper recompute.
 *  - if the signature changed, a fresh sort runs and the cache is updated.
 *
 * The signature is built from the sort key value of every element, so any
 * reordering invalidates the cache. A single slot is kept (most recent call).
 */
export function memoizedSort({ data, key, order = 'asc' }) {
  if (!Array.isArray(data)) return data;

  let signature = `${key}:${order}:`;
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const value = item == null ? '' : item[key];
    if (value == null) {
      signature += '~:';
    } else if (typeof value === 'string') {
      signature += `s${value}:`;
    } else {
      signature += `n${value}:`;
    }
  }

  if (signature === cacheSignature) {
    const byId = new Map();
    for (let i = 0; i < data.length; i++) {
      byId.set(data[i].id, data[i]);
    }
    const items = [];
    let idsMatch = true;
    for (let i = 0; i < cacheOrder.length; i++) {
      const item = byId.get(cacheOrder[i]);
      if (item === undefined) {
        idsMatch = false;
        break;
      }
      items.push(item);
    }
    if (idsMatch && items.length === data.length) {
      return items;
    }
    // Id set changed despite a matching signature — fall through to re-sort.
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

  cacheSignature = signature;
  cacheOrder = sorted.map((item) => item.id);
  return sorted;
}
