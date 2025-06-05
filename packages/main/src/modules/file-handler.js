// modules/file-handler.js
import path from 'path';

export class FileHandler {
  constructor() {
    this.queuedPath = null;
  }

  handleFileOpen(event, filePath, windowManager) {
    event.preventDefault();
    const mainWindow = windowManager.getWindow();

    if (mainWindow && mainWindow.webContents) {
      if (windowManager.isLoading()) {
        this.queuedPath = filePath;
      } else {
        windowManager.sendToRenderer('file-opened', filePath);
      }
    }
  }

  handleStartupFile(windowManager) {
    // Check for .bea file in command line arguments
    if (process.argv.length >= 2) {
      let filePath = this.findBeaFile();

      if (filePath) {
        const mainWindow = windowManager.getWindow();
        if (mainWindow && mainWindow.webContents) {
          if (windowManager.isLoading()) {
            this.queuedPath = filePath;
          } else {
            windowManager.sendToRenderer('file-opened', filePath);
          }
        }
      } else {
        this.logArguments();
      }
    }

    // Set up listener for when window finishes loading
    const mainWindow = windowManager.getWindow();
    if (mainWindow) {
      mainWindow.webContents.on('did-finish-load', () => {
        if (this.queuedPath) {
          windowManager.sendToRenderer('file-opened', this.queuedPath);
          this.queuedPath = null;
        }
      });
    }
  }

  findBeaFile() {
    // Iterate through argv to find the first argument that ends with .bea
    for (let i = 1; i < process.argv.length; i++) {
      const arg = process.argv[i];
      if (arg.endsWith('.bea')) {
        return path.resolve(arg).replace(/\\/g, '/');
      }
    }
    return null;
  }

  logArguments() {
    process.argv.forEach((arg) => {
      console.log(`Received argument: ${arg}`);
    });
  }
}
