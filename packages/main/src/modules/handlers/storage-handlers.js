// modules/handlers/storage-handlers.js
import { ipcMain } from 'electron-better-ipc';
import store from '../../store';

export class StorageHandlers {
  register() {
    ipcMain.answerRenderer('storage:store', (name) => store[name]?.store);

    ipcMain.answerRenderer(
      'storage:replace',
      ({ name, data }) => (store[name].store = data)
    );

    ipcMain.answerRenderer('storage:get', ({ name, key, def }) =>
      store[name]?.get(key, def)
    );

    ipcMain.answerRenderer('storage:set', ({ name, key, value }) =>
      store[name]?.set(key, value)
    );

    ipcMain.answerRenderer('storage:delete', ({ name, key }) =>
      store[name]?.delete(key)
    );

    ipcMain.answerRenderer('storage:has', ({ name, key }) =>
      store[name]?.has(key)
    );

    ipcMain.answerRenderer('storage:clear', (name) => store[name]?.clear());
  }
}
