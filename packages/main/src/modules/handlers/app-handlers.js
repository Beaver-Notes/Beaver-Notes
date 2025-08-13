import { ipcMain } from 'electron-better-ipc';
import { app, Notification, shell } from 'electron';
import path from 'path';
import { copy, pathExists } from 'fs-extra';
import chokidar from 'chokidar';
import os from 'os';

export class AppHandlers {
  register(windowManager) {
    this.windowManager = windowManager;

    ipcMain.answerRenderer('app:info', () => ({
      name: app.getName(),
      version: app.getVersion(),
    }));

    app.setAppUserModelId('com.beavernotes.beavernotes');

    ipcMain.answerRenderer('app:notification', ({ title, body }) => {
      new Notification({ title, body }).show();
    });

    ipcMain.answerRenderer('app:spellcheck', (isEnabled) => {
      const mainWindow = this.windowManager.getWindow();
      mainWindow.webContents.session.setSpellCheckerEnabled(isEnabled);
    });

    ipcMain.answerRenderer('open-file-external', async (src) => {
      const fullPath = path.isAbsolute(src)
        ? src
        : path.join(app.getPath('userData'), src);

      if (!(await pathExists(fullPath))) {
        throw new Error(`File not found: ${fullPath}`);
      }

      const ext = path.extname(fullPath);
      const base = path.basename(fullPath, ext);
      const tempFile = path.join(os.tmpdir(), `${base}-${Date.now()}${ext}`);

      await copy(fullPath, tempFile);
      console.log(`Copied to temp: ${tempFile}`);

      const win = this.windowManager.getWindow();
      chokidar
        .watch(tempFile, {
          ignoreInitial: true,
          awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
        })
        .on('change', async () => {
          await copy(tempFile, fullPath, { overwrite: true });
          console.log(`Synced back to: ${fullPath}`);
          ipcMain
            .callRenderer(win, 'file-updated', { originalPath: fullPath })
            .catch((err) => console.error('No reply from renderer', err));
        });

      await shell.openPath(tempFile);
      return tempFile;
    });

    ipcMain.answerRenderer('app:set-zoom', (newZoomLevel) => {
      const mainWindow = this.windowManager.getWindow();
      if (mainWindow?.webContents) {
        mainWindow.webContents.setZoomFactor(newZoomLevel);
      }
    });

    ipcMain.answerRenderer('app:get-zoom', () => {
      const mainWindow = this.windowManager.getWindow();
      return mainWindow.webContents.zoomFactor;
    });

    ipcMain.answerRenderer('app:change-menu-visibility', (visibility, win) =>
      win.setMenuBarVisibility(visibility),
    );
  }
}
