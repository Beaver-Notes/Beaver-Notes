import { contextBridge, clipboard } from 'electron';
import { ipcRenderer } from 'electron-better-ipc';
import { constants } from 'fs';
import { access } from 'fs/promises';
import path from 'path';

const apiKey = 'electron';

// Function to send notification
function notification(props) {
  return ipcRenderer.callMain('app:notification', props);
}

let closeFnList = [];
ipcRenderer.answerMain('win:close', async () => {
  await Promise.allSettled(closeFnList.map((fn) => fn()));
});

// API object for context bridge
const api = {
  path,
  clipboard,
  ipcRenderer,
  notification,
  access: (dir) => access(dir, constants.R_OK | constants.W_OK),
  versions: process.versions,
  addCloseFn: (fn) =>
    closeFnList.every((f) => f !== fn) && closeFnList.push(fn),
  onFileOpened: (callback) =>
    ipcRenderer.on('file-opened', (event, path) => callback(path)),
};

// Expose API to the main world
if (import.meta.env.MODE !== 'test') {
  contextBridge.exposeInMainWorld(apiKey, api);
} else {
  // Test mode runs with contextIsolation disabled so Playwright can access the
  // bridge directly. 
  window[apiKey] = api;
}
