// main.js
import path from 'path';
import { app } from 'electron';
import { existsSync } from 'fs';
import { copySync, removeSync } from 'fs-extra';
import { WindowManager } from './modules/window-manager.js';
import { ProtocolManager } from './modules/protocol-manager.js';
import { IPCHandlers } from './modules/ipc-handlers.js';
import { AutoUpdater } from './modules/auto-updater.js';
import { MenuManager } from './modules/menu-manager.js';
import { FileHandler } from './modules/file-handler.js';

// Migrate old data directory from "Beaver-notes" to "Beaver Notes"
// !!! To be removed in future versions !!!
app.on('ready', () => {
  const base = app.getPath('appData');
  const oldDir = path.join(base, 'Beaver-notes');
  const newDir = path.join(base, 'Beaver Notes');

  if (existsSync(oldDir)) {
    try {
      copySync(oldDir, newDir, { overwrite: true });
      removeSync(oldDir);
    } catch (e) {
      console.error('[Migration] Failed:', e);
    }
  }
});

app.setName('Beaver Notes');

let pendingFilePath = null;

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  pendingFilePath = filePath;
});

const isSingleInstance = app.requestSingleInstanceLock();
if (!isSingleInstance) {
  app.quit();
  process.exit(0);
}

if (process.env.PORTABLE_EXECUTABLE_DIR) {
  app.setPath(
    'userData',
    path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'data')
  );
}

class Application {
  constructor() {
    this.windowManager = new WindowManager();
    this.protocolManager = new ProtocolManager();
    this.ipcHandlers = new IPCHandlers();
    this.autoUpdater = new AutoUpdater();
    this.menuManager = new MenuManager();
    this.fileHandler = new FileHandler();
  }

  async initialize() {
    try {
      this.protocolManager.registerSchemes();
      await app.whenReady();

      await this.protocolManager.initialize();
      await this.ipcHandlers.initialize(this.windowManager);
      await this.windowManager.createWindow();
      await this.autoUpdater.initialize(this.windowManager);
      await this.menuManager.initialize(this.windowManager);

      if (pendingFilePath) {
        this.fileHandler.handleFileOpen(
          { preventDefault() {} },
          pendingFilePath,
          this.windowManager
        );
        pendingFilePath = null;
      }

      this.fileHandler.handleStartupFile(this.windowManager);
      this.setupEventListeners();
    } catch (error) {
      console.error('Failed to initialize application:', error);
    }
  }

  setupEventListeners() {
    app.on('open-file', (event, filePath) => {
      this.fileHandler.handleFileOpen(event, filePath, this.windowManager);
    });

    app.on('second-instance', () => {
      this.windowManager.focusWindow();
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit();
    });

    app.on(
      'NSApplicationDelegate.applicationSupportsSecureRestorableState',
      () => true
    );
  }
}

// Initialize application
const application = new Application();
application.initialize();
