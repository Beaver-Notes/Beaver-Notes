// modules/ipc-handlers.js
import { app, nativeTheme } from 'electron';
import { ipcMain } from 'electron-better-ipc';
import { AppHandlers } from './handlers/app-handlers.js';
import { DialogHandlers } from './handlers/dialog-handlers.js';
import { FileSystemHandlers } from './handlers/filesystem-handlers.js';
import { StorageHandlers } from './handlers/storage-handlers.js';
import { PDFHandler } from './handlers/pdf-handler.js';
import { FontHandler } from './handlers/fonts-handler.js';

export class IPCHandlers {
  constructor() {
    this.appHandlers = new AppHandlers();
    this.storageHandlers = new StorageHandlers();
    this.fileSystemHandlers = new FileSystemHandlers();
    this.dialogHandlers = new DialogHandlers();
    this.pdfHandler = new PDFHandler();
    this.fontHandler = new FontHandler();
  }

  async initialize(windowManager) {
    this.windowManager = windowManager;
    this.registerHandlers();
  }

  registerHandlers() {
    this.appHandlers.register(this.windowManager);
    this.dialogHandlers.register();
    this.fileSystemHandlers.register();
    this.storageHandlers.register();
    this.pdfHandler.register();
    this.fontHandler.register();
    this.registerHelperHandlers();
  }

  registerHelperHandlers() {
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
  }
}
