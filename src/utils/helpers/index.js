// ─── General-purpose helpers ─────────────────────────────────────────────────

export function debounce(callback, time = 200) {
  let interval;

  return (...args) => {
    clearTimeout(interval);

    return new Promise((resolve) => {
      interval = setTimeout(() => {
        interval = null;

        callback(...args);
        resolve();
      }, time);
    });
  };
}

export function sortArray({ data, key, order = 'asc' }) {
  if (!Array.isArray(data)) return console.error(`Data must be an array`);

  const sortedData = [...data].sort((a, b) => {
    let comparison = 0;
    const varA = typeof a[key] === 'string' ? a[key].toUpperCase() : a[key];
    const varB = typeof b[key] === 'string' ? b[key].toUpperCase() : b[key];

    if (varA > varB) comparison = 1;
    else if (varA < varB) comparison = -1;

    return order === 'desc' ? comparison * -1 : comparison;
  });

  return sortedData;
}

export function parseItemId(itemKey) {
  if (itemKey.startsWith('note-')) {
    return { type: 'note', id: itemKey.replace(/^note-/, '') };
  }
  if (itemKey.startsWith('folder-')) {
    return { type: 'folder', id: itemKey.replace(/^folder-/, '') };
  }
  return { type: null, id: null };
}

export function areSetsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

// ─── Conversion helpers ──────────────────────────────────────────────────────

/**
 * Decode a base64 string into a Uint8Array.
 * @param {string} base64
 * @returns {Uint8Array}
 */
export function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Remove characters that are invalid in file names across most file systems.
 * @param {string} name
 * @param {string} [fallback='Untitled']
 * @returns {string}
 */
export function sanitizeFileName(name, fallback = 'Untitled') {
  const sanitized = String(name || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"\\|?*\u0000-\u001F]/g, '-')
    .trim();
  return sanitized || fallback;
}

// ─── Date/time formatting ────────────────────────────────────────────────────

export function formatTime(time, format) {
  if (format === void 0) {
    format = 'YY-MM-DD hh:mm:ss';
  }
  if (!time) {
    return '';
  }
  let date;
  if (typeof time === 'number') {
    date = new Date(time);
  } else if (typeof time === 'string') {
    if (/^\d+$/g.test(time)) {
      date = new Date(+time);
    } else {
      date = new Date(time);
    }
  } else {
    date = time;
  }
  const map = {
    M: date.getMonth() + 1,
    D: date.getDate(),
    h: date.getHours(),
    m: date.getMinutes(),
    s: date.getSeconds(),
  };
  return format.replace(/([YMDhms])+/g, function (w, t) {
    const v = map[t];
    if (v !== undefined) {
      if (w.length > 1) {
        return ('0' + v).slice(-2);
      }
      return v;
    } else if ('Y' === t) {
      return (date.getFullYear() + '').slice(-w.length * 2);
    }
    return w;
  });
}

// ─── Deleted-IDs helpers ─────────────────────────────────────────────────────

export const DELETED_IDS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function pruneExpiredIds(deletedIds) {
  const cutoff = Date.now() - DELETED_IDS_TTL_MS;
  let dirty = false;
  for (const id of Object.keys(deletedIds)) {
    if (deletedIds[id] < cutoff) {
      delete deletedIds[id];
      dirty = true;
    }
  }
  return dirty;
}

export function collectExpiredIds(deletedIds, days = 30) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return Object.entries(deletedIds || {})
    .filter(([, timestamp]) => timestamp < cutoff)
    .map(([id]) => id);
}
