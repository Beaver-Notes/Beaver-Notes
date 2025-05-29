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
import windowStateKeeper from 'electron-window-state';
import * as browserStorage from 'electron-browser-storage';
import { autoUpdater } from 'electron-updater';
import { ipcMain } from 'electron-better-ipc';
import path, { join, normalize } from 'path';
import { URL } from 'url';
import {
  remove,
  readJson,
  ensureDir,
  copy,
  mkdir,
  statSync,
  pathExists,
  readdir,
  outputJson,
  pathExistsSync,
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync,
} from 'fs-extra';
import store from './store';

const { localStorage } = browserStorage;
const isMac = process.platform === 'darwin';
const isSingleInstance = app.requestSingleInstanceLock();

if (!isSingleInstance) {
  app.quit();
  process.exit(0);
}

if (process.env.PORTABLE_EXECUTABLE_DIR)
  app.setPath(
    'userData',
    path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'data')
  );

/**
 * Workaround for TypeScript bug
 * @see https://github.com/microsoft/TypeScript/issues/41468#issuecomment-727543400
 */
const env = import.meta.env;

let mainWindow = null;
let queuedPath = null;
let autoUpdateEnabled = true;

const createWindow = async () => {
  // Load the previous window state or fallback to defaults
  let mainWindowState = windowStateKeeper({
    defaultWidth: 1000,
    defaultHeight: 800,
  });

  // Create the window using the state information
  mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    webPreferences: {
      preload: join(__dirname, '../../preload/dist/index.cjs'),
      contextIsolation: env.MODE !== 'test',
      enableRemoteModule: env.MODE === 'test',
      nodeIntegration: true,
      spellcheck: true,
    },
  });

  mainWindowState.manage(mainWindow);

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
          'file://' + __dirname
        ).toString();

  await mainWindow.loadURL(pageUrl);
};

app.on('NSApplicationDelegate.applicationSupportsSecureRestorableState', () => {
  return true;
});

ipcMain.answerRenderer('print-pdf', async (options) => {
  const { pdfName } = options; // Default to black if not specified

  const focusedWindow = BrowserWindow.getFocusedWindow(); // Get the current window
  if (!focusedWindow) return;

  const { filePath } = await dialog.showSaveDialog(focusedWindow, {
    title: 'Save PDF',
    defaultPath: path.join(
      app.getPath('desktop'),
      pdfName || 'editor-output.pdf'
    ),
    filters: [
      { name: 'PDF Files', extensions: ['pdf'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  try {
    // Apply the custom background color and remove margins/padding
    await focusedWindow.webContents.executeJavaScript(`
      // Check if style already exists and remove it
      (() => {
        // Create a new style element
        const style = document.createElement('style');
        style.id = 'print-style'; // Unique ID to prevent conflicts
        style.innerHTML = \`
          @page {
            margin: 0;
          }
          html, body {
            width: 100%;
            height: 100%;
            margin: 0;
            padding: 0;
          }
          * {
            box-sizing: border-box;
          }
        \`;
        document.head.appendChild(style);
    
        // Apply background color directly
        document.body.style.margin = '0';
        document.body.style.padding = '0';
        document.documentElement.style.margin = '0';
        document.documentElement.style.padding = '0';
      })();
    `);

    // Generate the PDF with no margins
    const pdfData = await focusedWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      marginsType: 0,
    });

    // Save the PDF to the selected path
    writeFileSync(filePath, pdfData);
  } catch (error) {
    console.error(error);
  }
});

app.on('open-file', (event, path) => {
  event.preventDefault();
  if (mainWindow && mainWindow.webContents) {
    if (mainWindow.webContents.isLoading()) {
      queuedPath = path;
    } else {
      mainWindow.webContents.send('file-opened', path);
    }
  }
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

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'file-assets',
    privileges: { standard: true, secure: true, stream: true },
  },
]);

app
  .whenReady()
  .then(async () => {
    protocol.registerFileProtocol('assets', (request, callback) => {
      const url = request.url.substr(9);

      const dir = store.settings.get('dataDir');
      const imgPath = `${dir}/notes-assets/${url}`;

      callback({ path: normalize(imgPath) });
    });
    protocol.registerFileProtocol(
      'file-assets',
      (request, callback) => {
        try {
          const url = request.url.substr('file-assets://'.length);
          const decodedUrl = decodeURIComponent(url);
          const dir = store.settings.get('dataDir');
          const filePath = path.join(dir, 'file-assets', decodedUrl);

          if (!existsSync(filePath)) {
            console.error(`File not found: ${filePath}`);
            return callback({ error: -6 });
          }

          const mimeType = 'application/octet-stream';

          callback({
            path: filePath,
            headers: {
              'Content-Type': mimeType,
              'Access-Control-Allow-Origin': '*',
            },
          });
        } catch (err) {
          console.error('Error handling file-assets protocol:', err);
          callback({ error: -2 });
        }
      },
      (error) => {
        if (error) console.error('Failed to register protocol', error);
      }
    );

    await Promise.all([
      ensureDir(join(app.getPath('userData'), 'notes-assets')),
      ensureDir(join(app.getPath('userData'), 'file-assets')),
    ]);
    createWindow();
    if (process.argv.length >= 2) {
      let filePath = null;

      // Iterate through argv to find the first argument that ends with .bea
      for (let i = 1; i < process.argv.length; i++) {
        const arg = process.argv[i];

        // Check if the argument ends with .bea
        if (arg.endsWith('.bea')) {
          filePath = path.resolve(arg).replace(/\\/g, '/');
          break; // Stop at the first .bea file
        }
      }

      if (filePath) {
        if (mainWindow && mainWindow.webContents) {
          if (mainWindow.webContents.isLoading()) {
            queuedPath = filePath;
          } else {
            mainWindow.webContents.send('file-opened', filePath);
          }
        }
      } else {
        process.argv.forEach((arg) => {
          console.log(`Received argument: ${arg}`);
        });
      }
    }

    initializeMenu();
    mainWindow.webContents.on('did-finish-load', () => {
      if (queuedPath) {
        mainWindow.webContents.send('file-opened', queuedPath);
        queuedPath = null;
      }
    });
  })
  .catch((e) => console.error('Failed create window:', e));

autoUpdater.on('checking-for-update', () => {
  mainWindow?.webContents.send('update-status', 'Checking for updates...');
});

autoUpdater.on('update-available', (info) => {
  mainWindow?.webContents.send(
    'update-status',
    `Update available: ${info.version}`
  );
});

autoUpdater.on('update-not-available', () => {
  mainWindow?.webContents.send('update-status', 'No updates available.');
});

autoUpdater.on('download-progress', (progress) => {
  mainWindow?.webContents.send('update-progress', progress);
});

autoUpdater.on('update-downloaded', (info) => {
  mainWindow?.webContents.send(
    'update-status',
    `Update ready: ${info.version}`
  );
});

ipcMain.answerRenderer('check-for-updates', async () => {
  if (autoUpdateEnabled) {
    autoUpdater.checkForUpdates();
  }
});

ipcMain.answerRenderer('download-update', () => {
  autoUpdater.downloadUpdate();
});

ipcMain.answerRenderer('install-update', () => {
  autoUpdater.quitAndInstall();
});

ipcMain.answerRenderer('toggle-auto-update', (_, enabled) => {
  autoUpdateEnabled = enabled;
});

ipcMain.answerRenderer('get-auto-update-status', () => autoUpdateEnabled);

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
    return fullPath;
  } catch (error) {
    console.error(`Error opening file: ${error.message}`);
    throw error;
  }
});

ipcMain.answerRenderer('app:set-zoom', (newZoomLevel) => {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.setZoomFactor(newZoomLevel);
  }
});

ipcMain.answerRenderer('app:get-zoom', () => mainWindow.webContents.zoomFactor);

ipcMain.answerRenderer('app:change-menu-visibility', (visibility, win) =>
  win.setMenuBarVisibility(visibility)
);

ipcMain.answerRenderer('dialog:open', (props) => dialog.showOpenDialog(props));
ipcMain.answerRenderer('dialog:message', (props) =>
  dialog.showMessageBox(props)
);
ipcMain.answerRenderer('dialog:save', (props) => dialog.showSaveDialog(props));

ipcMain.answerRenderer('fs:copy', ({ path, dest }) => copy(path, dest));
ipcMain.answerRenderer('fs:output-json', ({ path, data }) =>
  outputJson(path, data)
);
ipcMain.answerRenderer('fs:read-json', (path) => readJson(path));
ipcMain.answerRenderer('fs:ensureDir', (path) => ensureDir(path));
ipcMain.answerRenderer('fs:pathExists', (path) => pathExistsSync(path));
ipcMain.answerRenderer('fs:remove', (path) => remove(path));
ipcMain.answerRenderer('fs:writeFile', ({ path, data }) =>
  writeFileSync(path, data)
);
ipcMain.answerRenderer('fs:readFile', (path) => readFileSync(path, 'utf8'));
ipcMain.answerRenderer('fs:readData', (filePath) => {
  if (filePath.startsWith('assets://')) {
    const url = filePath.substr(9);
    const dir = store.settings.get('dataDir');
    filePath = path.join(dir, 'notes-assets', url);
  } else if (filePath.startsWith('file-assets://')) {
    const url = filePath.substr(14);
    const dir = store.settings.get('dataDir');
    filePath = path.join(dir, 'file-assets', url);
  }

  try {
    return readFileSync(filePath, 'base64');
  } catch (error) {
    console.error('Error reading file:', error);
    return null;
  }
});
ipcMain.answerRenderer('fs:readdir', async (dirPath) => {
  return readdir(dirPath);
});
ipcMain.answerRenderer('fs:stat', async (filePath) => {
  return statSync(filePath);
});
ipcMain.answerRenderer('fs:mkdir', async (dirPath) => {
  await mkdir(dirPath, { recursive: true });
});
ipcMain.answerRenderer('fs:unlink', async (filePath) => {
  unlinkSync(filePath);
});
ipcMain.answerRenderer('fs:isFile', async (filePath) => {
  try {
    const isFile = await pathExists(filePath);
    return isFile;
  } catch (error) {
    console.error('Error checking if file exists:', error);
    throw error; // Propagate the error back to the renderer process
  }
});
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
  () => nativeTheme.shouldUseDarkColors
);

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
ipcMain.answerRenderer('storage:has', ({ name, key }) => store[name]?.has(key));
ipcMain.answerRenderer('storage:clear', (name) => store[name]?.clear());

function addNoteFromMenu() {
  mainWindow.webContents.executeJavaScript('addNote();');
}

async function getTranslations(lang = 'en') {
  const supportedLangs = [
    'en',
    'de',
    'es',
    'fr',
    'it',
    'nl',
    'tr',
    'ru',
    'uk',
    'zh',
  ];

  if (!supportedLangs.includes(lang)) lang = 'en';

  try {
    const translations = await import(
      `../../renderer/src/pages/settings/locales/${lang}.json`
    );
    return translations.default;
  } catch (error) {
    console.error(
      `Failed to load translations for ${lang}, falling back to English.`,
      error
    );
    const fallback = await import(
      '../../renderer/src/pages/settings/locales/en.json'
    );
    return fallback.default;
  }
}

async function initializeMenu() {
  const selectedLanguage = localStorage.getItem('selectedLanguage') || 'en';
  const translations = await getTranslations(selectedLanguage);

  import('electron-context-menu')
    .then((contextMenuModule) => {
      const contextMenu = contextMenuModule.default;

      contextMenu({
        showLookUpSelection: true,
        showSearchWithGoogle: true,
        showCopyImage: true,
        showSaveImageAs: true,
        showCopyLink: true,
        showInspectElement: true,
      });
    })
    .catch((error) => {
      console.error('Failed to load context menu:', error);
    });

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
          label: translations.commands.newnote,
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
          label: 'Docs',
          click: async () => {
            const { shell } = require('electron');
            await shell.openExternal('https://docs.beavernotes.com/');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
