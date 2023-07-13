function invokeEvent(name, param) {
  const { ipcRenderer } = window.electron;

  if (param.value) param.value = JSON.parse(JSON.stringify(param.value));

  return ipcRenderer.callMain(`storage:${name}`, param);
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
    clear: (storeName) => invokeEvent('clear', storeName || name),
    store: (storeName) => invokeEvent('store', storeName || name),
  };
}
