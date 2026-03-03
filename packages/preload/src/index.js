import { contextBridge, clipboard } from 'electron';
import { ipcRenderer } from 'electron-better-ipc';

const apiKey = 'electron';

// Function to send notification
function notification(props) {
  return ipcRenderer.callMain('app:notification', props);
}

let closeFnList = [];
ipcRenderer.answerMain('win:close', async () => {
  await Promise.allSettled(closeFnList.map((fn) => fn()));
});

const path = {
  join: (...args) => ipcRenderer.sendSync('path:join', args),
  dirname: (p) => ipcRenderer.sendSync('path:dirname', p),
  basename: (p) => ipcRenderer.sendSync('path:basename', p),
  extname: (p) => ipcRenderer.sendSync('path:extname', p),
};

function access(dir) {
  return ipcRenderer.callMain('fs:access', dir);
}

// API object for context bridge
const api = {
  path,
  clipboard,
  ipcRenderer,
  notification,
  access,
  versions: process.versions,
  addCloseFn: (fn) =>
    closeFnList.every((f) => f !== fn) && closeFnList.push(fn),
  onFileOpened: (callback) =>
    ipcRenderer.on('file-opened', (event, path) => callback(path)),
};

try {
  contextBridge.exposeInMainWorld(apiKey, api);
} catch {
  window[apiKey] = api;
}
