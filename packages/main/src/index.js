// main.js - Main entry point
import path from 'path';
import { app } from 'electron';
import { dialog } from 'electron';
import { WindowManager } from './modules/window-manager.js';
import { ProtocolManager } from './modules/protocol-manager.js';
import * as browserStorage from 'electron-browser-storage';
import { IPCHandlers } from './modules/ipc-handlers.js';
import { AutoUpdater } from './modules/auto-updater.js';
import { MenuManager } from './modules/menu-manager.js';
import { FileHandler } from './modules/file-handler.js';

const { localStorage } = browserStorage;

const isSingleInstance = app.requestSingleInstanceLock();

if (!isSingleInstance) {
  app.quit();
  process.exit(0);
}

// Handle portable executable
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
      // Register protocols before app ready
      this.protocolManager.registerSchemes();

      await app.whenReady();

      await this.protocolManager.initialize();
      await this.ipcHandlers.initialize(this.windowManager);
      await this.windowManager.createWindow();
      await this.autoUpdater.initialize(this.windowManager);
      await this.menuManager.initialize();
      this.fileHandler.handleStartupFile(this.windowManager);

      this.setupEventListeners();
    } catch (error) {
      console.error('Failed to initialize application:', error);
    }
  }

  setupEventListeners() {
    app.on('open-file', (event, path) => {
      this.fileHandler.handleFileOpen(event, path, this.windowManager);
    });

    app.on('second-instance', () => {
      this.windowManager.focusWindow();
    });

    app.on('before-quit', async (event) => {
      if (this.autoUpdater.isBusy) {
        event.preventDefault();

        const window = this.windowManager.getWindow();
        const selectedLanguage =
          localStorage.getItem('selectedLanguage') || 'en';
        const translations = await this.autoUpdater.getTranslations(
          selectedLanguage
        );

        const result = await dialog.showMessageBox(window, {
          type: 'warning',
          buttons: [
            translations.settings.cancelUpdate,
            translations.settings.continueUpdate,
          ],
          defaultId: 1,
          cancelId: 1,
          title: translations.settings.updateInProgressTitle,
          message: translations.settings.updateInProgress,
          detail: translations.settings.updateInProgressDetail,
        });

        if (result.response === 0) {
          // User chose to cancel update and quit
          this.autoUpdater.cancelUpdate?.();
          app.quit(); // Try quitting again after canceling
        }

        // If user chose to continue update, do nothing (quit remains canceled)
      }
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on(
      'NSApplicationDelegate.applicationSupportsSecureRestorableState',
      () => {
        return true;
      }
    );
  }
}

// Initialize application
const application = new Application();
application.initialize();
