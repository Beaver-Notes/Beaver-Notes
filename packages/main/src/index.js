import { app, BrowserWindow, dialog, protocol, nativeTheme, shell } from 'electron';
import { ipcMain } from 'electron-better-ipc';
import { join, normalize } from 'path';
import { URL } from 'url';
import { remove, readJson, ensureDir, copy, outputJson, pathExistsSync } from 'fs-extra';
import { autoUpdater } from 'electron-updater';
import store from './store';

const isSingleInstance = app.requestSingleInstanceLock();

if (!isSingleInstance) {
  app.quit();
  process.exit(0);
}

app.disableHardwareAcceleration();

/**
 * Workaround for TypeScript bug
 * @see https://github.com/microsoft/TypeScript/issues/41468#issuecomment-727543400
 */
const env = import.meta.env;


// Install "Vue.js devtools"
if (env.MODE === 'development') {
  app.whenReady()
    .then(() => import('electron-devtools-installer'))
    .then(({default: installExtension, VUEJS3_DEVTOOLS}) => installExtension(VUEJS3_DEVTOOLS, {
      loadExtensionOptions: {
        allowFileAccess: true,
      },
    }))
    .catch(e => console.error('Failed install extension:', e));
}

let mainWindow = null;

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    show: false, // Use 'ready-to-show' event to show window
    width: 950,
    height: 600,
    webPreferences: {
      preload: join(__dirname, '../../preload/dist/index.cjs'),
      contextIsolation: env.MODE !== 'test',   // Spectron tests can't work with contextIsolation: true
      enableRemoteModule: env.MODE === 'test', // Spectron tests can't work with enableRemoteModule: false
    },
  });

  mainWindow.setMenuBarVisibility(false);

  /**
   * If you install `show: true` then it can cause issues when trying to close the window.
   * Use `show: false` and listener events `ready-to-show` to fix these issues.
   *
   * @see https://github.com/electron/electron/issues/25012
   */
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();

    if (env.MODE === 'development') {
      mainWindow?.webContents.openDevTools();
    } else {
      autoUpdater.checkForUpdatesAndNotify();
    }
  });

  mainWindow?.webContents.on('new-window', function(event, url) {
    event.preventDefault();

    if (url.startsWith('note://')) return;

    shell.openExternal(url);
  });

  /**
   * URL for main window.
   * Vite dev server for development.
   * `file://../renderer/index.html` for production and test
   */
  const pageUrl = env.MODE === 'development'
    ? env.VITE_DEV_SERVER_URL
    : new URL('../renderer/dist/index.html', 'file://' + __dirname).toString();


  await mainWindow.loadURL(pageUrl);
};


app.on('second-instance', () => {
  // Someone tried to run a second instance, we should focus our window.
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});


app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});


app.whenReady()
  .then(async () => {
    protocol.registerFileProtocol('assets', (request, callback) => {
      const url = request.url.substr(9);

      const dir = store.settings.get('dataDir');
      const imgPath = `${dir}/notes-assets/${url}`;

      callback({ path: normalize(imgPath) });
    });

    await ensureDir(join(app.getPath('userData'), 'notes-assets'));
    await createWindow();
  })
  .catch((e) => console.error('Failed create window:', e));


// Auto-updates
if (env.PROD) {
  app.whenReady()
    .then(() => import('electron-updater'))
    .then(({ autoUpdater }) => autoUpdater.checkForUpdatesAndNotify())
    .catch((e) => console.error('Failed check updates:', e));
}

ipcMain.answerRenderer('app:info', () => ({
  name: app.getName(),
  version: app.getVersion(),
}));

ipcMain.answerRenderer('dialog:open', (props) => dialog.showOpenDialog(props));
ipcMain.answerRenderer('dialog:message', (props) => dialog.showMessageBox(props));
ipcMain.answerRenderer('dialog:save', (props) => dialog.showSaveDialog(props));

ipcMain.answerRenderer('fs:copy', ({ path, dest }) => copy(path, dest));
ipcMain.answerRenderer('fs:output-json', ({ path, data }) => outputJson(path, data));
ipcMain.answerRenderer('fs:read-json', (path) => readJson(path));
ipcMain.answerRenderer('fs:ensureDir', (path) => ensureDir(path));
ipcMain.answerRenderer('fs:pathExists', (path) => pathExistsSync(path));
ipcMain.answerRenderer('fs:remove', (path) => remove(path));

ipcMain.answerRenderer('helper:relaunch', (options = {}) => {
  app.relaunch({ args: process.argv.slice(1).concat(['--relaunch']), ...options });
  app.exit(0);
});
ipcMain.answerRenderer('helper:get-path', (name) => app.getPath(name));
ipcMain.answerRenderer('helper:is-dark-theme', () => nativeTheme.shouldUseDarkColors);

ipcMain.answerRenderer('storage:store', (name) => store[name]?.store);
ipcMain.answerRenderer('storage:replace', ({ name, data }) => (store[name].store = data));
ipcMain.answerRenderer('storage:get', ({ name, key, def }) => store[name]?.get(key, def));
ipcMain.answerRenderer('storage:set', ({ name, key, value }) => store[name]?.set(key, value));
ipcMain.answerRenderer('storage:delete', ({ name, key }) => store[name]?.delete(key));
ipcMain.answerRenderer('storage:has', ({ name, key }) => store[name]?.has(key));
ipcMain.answerRenderer('storage:clear', (name) => store[name]?.clear());
