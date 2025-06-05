// modules/handlers/app-handlers.js
import { ipcMain } from 'electron-better-ipc';
import { app, Notification, shell } from 'electron';
import path from 'path';

export class AppHandlers {
  register(windowManager) {
    this.windowManager = windowManager;

    ipcMain.answerRenderer('app:info', () => ({
      name: app.getName(),
      version: app.getVersion(),
    }));

    ipcMain.answerRenderer('app:notification', ({ title, body }) => {
      new Notification({ title, body }).show();
    });

    ipcMain.answerRenderer('app:spellcheck', (isEnabled) => {
      const mainWindow = this.windowManager.getWindow();
      mainWindow.webContents.session.setSpellCheckerEnabled(isEnabled);
    });

    ipcMain.answerRenderer('open-file-external', async (src) => {
      let fullPath;
      if (src.startsWith('/')) {
        fullPath = src;
      } else {
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
      const mainWindow = this.windowManager.getWindow();
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.setZoomFactor(newZoomLevel);
      }
    });

    ipcMain.answerRenderer('app:get-zoom', () => {
      const mainWindow = this.windowManager.getWindow();
      return mainWindow.webContents.zoomFactor;
    });

    ipcMain.answerRenderer('app:change-menu-visibility', (visibility, win) =>
      win.setMenuBarVisibility(visibility)
    );
  }
}
