import {
  clearStore,
  deleteStoredValue,
  getStore,
  getStoredValue,
  hasStoredValue,
  replaceStore,
  setStoredValue,
} from '@/lib/native/storage';

function invokeEvent(name, param) {
  if (param.value) param.value = JSON.parse(JSON.stringify(param.value));
  const { name: storeName, key, def, value, data } = param;

  switch (name) {
    case 'get':
      return getStoredValue(storeName, key, def);
    case 'set':
      return setStoredValue(storeName, key, value);
    case 'has':
      return hasStoredValue(storeName, key);
    case 'replace':
      return replaceStore(storeName, data);
    case 'delete':
      return deleteStoredValue(storeName, key);
    case 'clear':
      return clearStore(storeName);
    case 'store':
      return getStore(storeName);
    default:
      throw new Error(`Unknown storage action: ${name}`);
  }
}

export function useStorage(name = 'data') {
  return {
    get: (key, def, storeName) =>
      invokeEvent('get', { name: storeName || name, key, def }),
    set: (key, value, storeName) =>
      invokeEvent('set', { name: storeName || name, key, value }),
    has: (key, storeName) =>
      invokeEvent('has', { name: storeName || name, key }),
    replace: (data, storeName) =>
      invokeEvent('replace', { name: storeName || name, data }),
    delete: (key, storeName) =>
      invokeEvent('delete', { name: storeName || name, key }),
    clear: (storeName) => invokeEvent('clear', { name: storeName || name }),
    store: (storeName) => invokeEvent('store', { name: storeName || name }),
  };
}

export function useLocalStorage(key, options) {
  const { defaultValue, parse, stringify } = options || {};
  function get(key, defaultValue, parse) {
    let value = localStorage.getItem(key);
    if (defaultValue != null && value == null) {
      value =
        typeof defaultValue === 'function' ? defaultValue(value) : defaultValue;
      set(key, value, stringify || ((v) => JSON.stringify(v)));
    }
    if (typeof value !== 'string') {
      return value;
    }
    return parse(value);
  }
  function set(key, value, stringify) {
    if (typeof value !== 'object') {
      localStorage.setItem(key, value);
      return;
    }
    if (value == null) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, stringify(value));
  }
  return {
    get() {
      return get(key, defaultValue, parse || ((v) => v));
    },
    set(value) {
      return set(key, value, stringify || ((v) => JSON.stringify(v)));
    },
  };
}
