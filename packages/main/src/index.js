import {
  app,
  BrowserWindow,
  dialog,
  protocol,
  nativeTheme,
  shell,
  Menu,
  Notification,
} from 'electron';
import { ipcMain } from 'electron-better-ipc';
import path, { join, normalize } from 'path';
import { URL } from 'url';
import {
  remove,
  readJson,
  ensureDir,
  copy,
  outputJson,
  pathExistsSync,
  writeFileSync,
} from 'fs-extra';
import store from './store';

const isMac = process.platform === 'darwin';

const isSingleInstance = app.requestSingleInstanceLock();

if (!isSingleInstance) {
  app.quit();
  process.exit(0);
}

/**
 * Workaround for TypeScript bug
 * @see https://github.com/microsoft/TypeScript/issues/41468#issuecomment-727543400
 */
const env = import.meta.env;

let mainWindow = null;

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    show: false,
    width: 950,
    height: 600,
    webPreferences: {
      preload: join(__dirname, '../../preload/dist/index.cjs'),
      contextIsolation: env.MODE !== 'test',
      enableRemoteModule: env.MODE === 'test',
      nodeIntegration: true,
      spellcheck: true,
    },
  });

  mainWindow.setMenuBarVisibility(true); // Show menu bar

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();

    if (env.MODE === 'development') {
      mainWindow?.webContents.openDevTools();
    }
  });

  mainWindow?.webContents.setWindowOpenHandler(function (details) {
    const url = details.url;
    if (url.startsWith('note://')) return;

    shell.openExternal(url);
    return {
      action: 'deny',
    };
  });

  const pageUrl =
    env.MODE === 'development'
      ? env.VITE_DEV_SERVER_URL
      : new URL(
          '../renderer/dist/index.html',
          'file://' + __dirname,
        ).toString();

  await mainWindow.loadURL(pageUrl);
};

app.on('NSApplicationDelegate.applicationSupportsSecureRestorableState', () => {
  return true;
});

app.on('second-instance', () => {
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

app
  .whenReady()
  .then(async () => {
    protocol.registerFileProtocol('assets', (request, callback) => {
      const url = request.url.substr(9);

      const dir = store.settings.get('dataDir');
      const imgPath = `${dir}/notes-assets/${url}`;

      callback({ path: normalize(imgPath) });
    });

    await ensureDir(join(app.getPath('userData'), 'notes-assets'));
    createWindow();
  })
  .catch((e) => console.error('Failed create window:', e));

ipcMain.answerRenderer('app:info', () => ({
  name: app.getName(),
  version: app.getVersion(),
}));

ipcMain.answerRenderer('app:notification', ({ title, body }) => {
  new Notification({ title, body }).show();
});

ipcMain.answerRenderer('app:spellcheck', (isEnabled) => {
  mainWindow.webContents.session.setSpellCheckerEnabled(isEnabled);
});

ipcMain.answerRenderer('open-file-external', async (src) => {
  let fullPath;
  if (src.startsWith('/')) {
    // If src already contains the full path
    fullPath = src;
  } else {
    // If src is a relative path
    fullPath = path.join(app.getPath('userData'), src);
  }
  
  try {
    await shell.openPath(fullPath);
    console.log(`File ${fullPath} opened successfully`);
    return fullPath;
  } catch (error) {
    console.error(`Error opening file: ${error.message}`);
    throw error;
  }
});

ipcMain.answerRenderer('app:set-zoom', (newZoomLevel) => {
  mainWindow.webContents.zoomFactor = newZoomLevel;
});

ipcMain.answerRenderer('app:get-zoom', () => mainWindow.webContents.zoomFactor);

ipcMain.answerRenderer('app:change-menu-visibility', (visibility, win) => win.setMenuBarVisibility(visibility));

ipcMain.answerRenderer('dialog:open', (props) => dialog.showOpenDialog(props));
ipcMain.answerRenderer('dialog:message', (props) =>
  dialog.showMessageBox(props),
);
ipcMain.answerRenderer('dialog:save', (props) => dialog.showSaveDialog(props));

ipcMain.answerRenderer('fs:copy', ({ path, dest }) => copy(path, dest));
ipcMain.answerRenderer('fs:output-json', ({ path, data }) =>
  outputJson(path, data),
);
ipcMain.answerRenderer('fs:read-json', (path) => readJson(path));
ipcMain.answerRenderer('fs:ensureDir', (path) => ensureDir(path));
ipcMain.answerRenderer('fs:pathExists', (path) => pathExistsSync(path));
ipcMain.answerRenderer('fs:remove', (path) => remove(path));
ipcMain.answerRenderer('fs:writeFile', ({ path, data }) =>
  writeFileSync(path, data),
);
ipcMain.answerRenderer('helper:relaunch', (options = {}) => {
  app.relaunch({
    args: process.argv.slice(1).concat(['--relaunch']),
    ...options,
  });
  app.exit(0);
});
ipcMain.answerRenderer('helper:get-path', (name) => app.getPath(name));
ipcMain.answerRenderer(
  'helper:is-dark-theme',
  () => nativeTheme.shouldUseDarkColors,
);

ipcMain.answerRenderer('storage:store', (name) => store[name]?.store);
ipcMain.answerRenderer(
  'storage:replace',
  ({ name, data }) => (store[name].store = data),
);
ipcMain.answerRenderer('storage:get', ({ name, key, def }) =>
  store[name]?.get(key, def),
);
ipcMain.answerRenderer('storage:set', ({ name, key, value }) =>
  store[name]?.set(key, value),
);
ipcMain.answerRenderer('storage:delete', ({ name, key }) =>
  store[name]?.delete(key),
);
ipcMain.answerRenderer('storage:has', ({ name, key }) => store[name]?.has(key));
ipcMain.answerRenderer('storage:clear', (name) => store[name]?.clear());

function addNoteFromMenu() {
  mainWindow.webContents.executeJavaScript('addNote();');
}

// Function to set the application menu

const template = [
  // { role: 'appMenu' }
  ...(isMac
    ? [
        {
          label: app.name,
          submenu: [
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
      ]
    : []),
  // { role: 'fileMenu' }
  {
    label: 'File',
    submenu: [
      {
        label: 'New Note',
        accelerator: 'CmdOrCtrl+N',
        click: addNoteFromMenu,
      },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  },
  // { role: 'editMenu' }
  {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      ...(isMac
        ? [
            { role: 'pasteAndMatchStyle' },
            { role: 'delete' },
            { role: 'selectAll' },
            { type: 'separator' },
            {
              label: 'Speech',
              submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }],
            },
          ]
        : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }]),
    ],
  },
  // { role: 'viewMenu' }
  {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  },
  // { role: 'windowMenu' }
  {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      ...(isMac
        ? [
            { type: 'separator' },
            { role: 'front' },
            { type: 'separator' },
            { role: 'window' },
          ]
        : [{ role: 'close' }]),
    ],
  },
  {
    role: 'help',
    submenu: [
      {
        label: 'Beaver Help',
        click: async () => {
          const { shell } = require('electron');
          await shell.openExternal(
            'https://danieles-organization.gitbook.io/beaver-notes',
          );
        },
      },
    ],
  },
];

const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);
