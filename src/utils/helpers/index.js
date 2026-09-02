import { shallowReactive } from 'vue';
import { bufToBase64, base64ToBuf } from '@/utils/crypto/codec.js';
import { memoizedSort } from './memoized-sort.js';
import dayjs from '@/lib/dayjs.js';

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

export function sortArray(opts) {
  return memoizedSort(opts);
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

export const base64ToUint8Array = base64ToBuf;
export function uint8ArrayToBase64(data) {
  if (typeof data === 'string') return bufToBase64(new TextEncoder().encode(data));
  if (Array.isArray(data)) return bufToBase64(new Uint8Array(data));
  return bufToBase64(data);
}

export function sanitizeFileName(name, fallback = 'Untitled') {
  const sanitized = String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .trim();
  return sanitized || fallback;
}

export function formatTime(time, format = 'YY-MM-DD HH:mm:ss') {
  if (!time) return '';
  return dayjs(time).format(format.replace('hh', 'HH'));
}

export function collectExpiredIds(deletedIds, days = 30) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const result = [];
  for (const [id, timestamp] of Object.entries(deletedIds || {})) {
    if (timestamp < cutoff) result.push(id);
  }
  return result;
}

export function createProgressState(extra = {}) {
  return shallowReactive({
    running: false,
    done: 0,
    total: 0,
    result: null,
    ...extra,
  });
}
