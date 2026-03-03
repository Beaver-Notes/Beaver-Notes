// modules/handlers/storage-handlers.js
import { ipcMain } from 'electron-better-ipc';
import store from '../../store';

const ALLOWED_STORES = new Set(['data', 'settings']);

function guard(name) {
  if (!ALLOWED_STORES.has(name)) {
    console.warn(`[storage] blocked access to unknown store: "${name}"`);
    return false;
  }
  return true;
}

function getStore(name) {
  if (!guard(name)) return null;
  return store[name] ?? null;
}

export class StorageHandlers {
  register() {
    ipcMain.answerRenderer('storage:store', (name) => getStore(name)?.store);
    ipcMain.answerRenderer('storage:replace', ({ name, data }) => {
      const target = getStore(name);
      if (target) target.store = data;
    });
    ipcMain.answerRenderer('storage:get', ({ name, key, def }) =>
      getStore(name)?.get(key, def) ?? def
    );
    ipcMain.answerRenderer('storage:set', ({ name, key, value }) => {
      getStore(name)?.set(key, value);
    });
    ipcMain.answerRenderer('storage:delete', ({ name, key }) => {
      getStore(name)?.delete(key);
    });
    ipcMain.answerRenderer('storage:has', ({ name, key }) =>
      getStore(name)?.has(key) ?? false
    );
    ipcMain.answerRenderer('storage:clear', (name) => {
      getStore(name)?.clear();
    });
  }
}
