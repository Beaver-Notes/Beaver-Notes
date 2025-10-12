// modules/file-handler.js
import path from 'path';

export class FileHandler {
  constructor() {
    this.queuedPath = null;
  }

  handleFileOpen(event, filePath, windowManager) {
    event.preventDefault();

    const mainWindow = windowManager.getWindow();
    if (!mainWindow || !mainWindow.webContents) return;

    if (windowManager.isLoading()) {
      this.queuedPath = filePath;
    } else {
      windowManager.sendToRenderer('file-opened', filePath);
    }

    mainWindow.webContents.once('did-finish-load', () => {
      if (this.queuedPath) {
        windowManager.sendToRenderer('file-opened', this.queuedPath);
        this.queuedPath = null;
      }
    });
  }

  handleStartupFile(windowManager) {
    const filePath = this.findBeaFile();
    if (!filePath) return;

    const mainWindow = windowManager.getWindow();
    if (!mainWindow) return;

    if (windowManager.isLoading()) {
      this.queuedPath = filePath;
    } else {
      windowManager.sendToRenderer('file-opened', filePath);
    }

    mainWindow.webContents.once('did-finish-load', () => {
      if (this.queuedPath) {
        windowManager.sendToRenderer('file-opened', this.queuedPath);
        this.queuedPath = null;
      }
    });
  }

  findBeaFile() {
    for (let i = 1; i < process.argv.length; i++) {
      if (process.argv[i].endsWith('.bea')) {
        return path.resolve(process.argv[i]);
      }
    }
    return null;
  }
}
