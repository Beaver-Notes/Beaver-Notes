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
import { ipcMain } from 'electron-better-ipc';
const { exec } = require('child_process');
import path, { join, normalize } from 'path';
import { URL } from 'url';
const fs = require('node:fs');
import {
  remove,
  readJson,
  ensureDir,
  copy,
  statSync,
  pathExists,
  readdir,
  outputJson,
  pathExistsSync,
  writeFileSync,
} from 'fs-extra';
import store from './store';
import enTranslations from '../../renderer/src/pages/settings/locales/en.json';
import itTranslations from '../../renderer/src/pages/settings/locales/it.json';
import deTranslations from '../../renderer/src/pages/settings/locales/de.json';
import zhTranslations from '../../renderer/src/pages/settings/locales/zh.json';
import nlTranslations from '../../renderer/src/pages/settings/locales/nl.json';
import esTranslations from '../../renderer/src/pages/settings/locales/es.json';
import ukTranslations from '../../renderer/src/pages/settings/locales/uk.json';
import trTranslation from '../../renderer/src/pages/settings/locales/tr.json';
import ruTranslations from '../../renderer/src/pages/settings/locales/ru.json';
import frTranslations from '../../renderer/src/pages/settings/locales/fr.json';

const { localStorage } = browserStorage;

let pendingFilePath = null;

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

    if (pendingFilePath) {
      mainWindow.webContents.send('open-file-path', pendingFilePath);
      pendingFilePath = null;
    }
  });

  let canClosed = false;
  mainWindow.on('close', (e) => {
    if (canClosed) {
      return;
    }
    e.preventDefault();
    windowCloseHandler(mainWindow);
    canClosed = true;
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
  console.log('printing');
  const { backgroundColor = '#000000', pdfName } = options; // Default to black if not specified
  console.log(options);

  const focusedWindow = BrowserWindow.getFocusedWindow(); // Get the current window
  if (!focusedWindow) return;

  const { canceled, filePath } = await dialog.showSaveDialog(focusedWindow, {
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

  if (canceled || !filePath) {
    console.log('Save operation canceled by the user.');
    return;
  }

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
            background-color: ${backgroundColor};
          }
          * {
            box-sizing: border-box;
          }
        \`;
        document.head.appendChild(style);
    
        // Apply background color directly
        document.body.style.backgroundColor = '${backgroundColor}';
        document.body.style.margin = '0';
        document.body.style.padding = '0';
        document.documentElement.style.backgroundColor = '${backgroundColor}';
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
    fs.writeFileSync(filePath, pdfData);
  } catch (error) {
    console.error(error);
  }
});

app.on('open-file', (event, path) => {
  event.preventDefault();
  pendingFilePath = path;
  if (mainWindow) {
    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once('did-finish-load', () => {
        localStorage.setItem('openFilePath', `${path}`);
      });
    } else {
      localStorage.setItem('openFilePath', `${path}`);
    }
  }
});

async function windowCloseHandler(win) {
  try {
    await ipcMain.callRenderer(win, 'win:close');
  } catch (error) {
    console.error('Error handling window close:', error);
  } finally {
    app.quit();
  }
}

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
    protocol.registerFileProtocol('file-assets', (request, callback) => {
      const url = request.url.substr(12);
      const dir = store.settings.get('dataDir');
      const filePath = `${dir}/file-assets/${url}`;
      callback({ path: normalize(filePath) });
    });
    await Promise.all([
      ensureDir(join(app.getPath('userData'), 'notes-assets')),
      ensureDir(join(app.getPath('userData'), 'file-assets')),
    ]);
    createWindow();
    if (process.argv.length >= 2) {
      let filePath = process.argv[1];
      filePath = path.resolve(filePath).replace(/\\/g, '/'); // Ensure proper formatting

      if (path.extname(filePath).toLowerCase() === '.bea') {
        localStorage.setItem('openFilePath', filePath);
      }
    }

    initializeMenu();
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
ipcMain.answerRenderer('fs:readFile', (path) => fs.readFileSync(path, 'utf8'));
ipcMain.answerRenderer('fs:readData', (path) =>
  fs.readFileSync(path, 'base64')
);
ipcMain.answerRenderer('fs:readdir', async (dirPath) => {
  return readdir(dirPath);
});
ipcMain.answerRenderer('fs:stat', async (filePath) => {
  return statSync(filePath);
});
ipcMain.answerRenderer('fs:unlink', async (filePath) => {
  fs.unlinkSync(filePath);
});
ipcMain.handle('fs:isFile', async (filePath) => {
  try {
    const isFile = await pathExists(filePath);
    return isFile;
  } catch (error) {
    console.error('Error checking if file exists:', error);
    throw error; // Propagate the error back to the renderer process
  }
});
ipcMain.answerRenderer('gvfs:copy', async ({ path, dest }) => {
  try {
    await new Promise((resolve, reject) => {
      exec(`cp -r '${path}/' '${dest}/'`, (error, stdout, stderr) => {
        if (error) {
          console.error('Error copying using gvfs-move:', error);
          reject(error);
          return;
        }
        console.log('stdout:', stdout);
        console.error('stderr:', stderr);
        resolve();
      });
    });
  } catch (error) {
    console.error('Error during gvfs-move:', error);
    throw error;
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

function initializeMenu() {
  // languages

  const selectedLanguage = localStorage.getItem('selectedLanguage') || 'en';

  let translations = enTranslations;

  if (selectedLanguage === 'de') {
    translations = deTranslations;
  } else if (selectedLanguage === 'en') {
    translations = enTranslations;
  } else if (selectedLanguage === 'es') {
    translations = esTranslations;
  } else if (selectedLanguage === 'fr') {
    translations = frTranslations;
  } else if (selectedLanguage === 'it') {
    translations = itTranslations;
  } else if (selectedLanguage === 'nl') {
    translations = nlTranslations;
  } else if (selectedLanguage === 'tr') {
    translations = trTranslation;
  } else if (selectedLanguage === 'ru') {
    translations = ruTranslations;
  } else if (selectedLanguage === 'uk') {
    translations = ukTranslations;
  } else if (selectedLanguage === 'zh') {
    translations = zhTranslations;
  }

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
          label: 'Beaver Help',
          click: async () => {
            const { shell } = require('electron');
            await shell.openExternal(
              'https://danieles-organization.gitbook.io/beaver-notes'
            );
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
