import { ipcMain } from 'electron-better-ipc';
import { app, Notification, shell } from 'electron';
import path from 'path';
import {
  ensureDirSync,
  pathExists,
  readFileSync,
  remove,
  writeFileSync,
} from 'fs-extra';
import chokidar from 'chokidar';
import os from 'os';
import store from '../../store';
import {
  isLocalAssetPath,
  maybeDecryptAssetBufferForPath,
  maybeEncryptAssetBufferForPath,
} from '../security/app-asset-crypto';
import { resolveAssetPathFromAssetUri } from '../security/asset-paths';
import { assertPathAccess } from '../security/fs-access';

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
      src = decodeURI(src);

      if (src.startsWith('file-assets:') && !src.startsWith('file-assets://')) {
        src = src.replace('file-assets:', 'file-assets://');
      }

      let fullPath;
      try {
        fullPath = resolveAssetPathFromAssetUri(src);
      } catch {
        const dataDir = store.settings.get('dataDir') || app.getPath('userData');
        fullPath = path.isAbsolute(src) ? src : path.join(dataDir, src);
      }

      assertPathAccess(fullPath, 'open file externally');

      if (!(await pathExists(fullPath))) {
        throw new Error(`File not found: ${fullPath}`);
      }

      const ext = path.extname(fullPath);
      const base = path.basename(fullPath, ext);
      const tempDir = path.join(os.tmpdir(), 'beaver-notes-open');
      ensureDirSync(tempDir);
      const tempFile = path.join(tempDir, `${base}-${Date.now()}${ext}`);

      const writeTempFile = (payload) => {
        writeFileSync(tempFile, payload, { mode: 0o600 });
      };
      if (isLocalAssetPath(fullPath)) {
        const raw = readFileSync(fullPath);
        const plain = maybeDecryptAssetBufferForPath(fullPath, raw);
        writeTempFile(plain);
      } else {
        writeTempFile(readFileSync(fullPath));
      }
      console.log(`Copied to temp: ${tempFile}`);

      const win = this.windowManager.getWindow();
      const watcher = chokidar
        .watch(tempFile, {
          ignoreInitial: true,
          awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
        })
        .on('change', async () => {
          if (isLocalAssetPath(fullPath)) {
            const plain = readFileSync(tempFile);
            const encrypted = maybeEncryptAssetBufferForPath(fullPath, plain);
            writeFileSync(fullPath, encrypted);
          } else {
            writeFileSync(fullPath, readFileSync(tempFile));
          }
          console.log(`Synced back to: ${fullPath}`);
          ipcMain
            .callRenderer(win, 'file-updated', { originalPath: fullPath })
            .catch((err) => console.error('No reply from renderer', err));
        });

      let closed = false;
      const cleanup = async () => {
        if (closed) return;
        closed = true;
        try {
          await watcher.close();
        } catch {
          // ignore close failures
        }
        await remove(tempFile).catch(() => {});
      };

      watcher.on('unlink', () => {
        void cleanup();
      });
      watcher.on('error', () => {
        void cleanup();
      });

      if (win) {
        win.once('closed', () => {
          void cleanup();
        });
      }

      app.once('before-quit', () => {
        void cleanup();
      });

      const openError = await shell.openPath(tempFile);
      if (openError) {
        await cleanup();
        throw new Error(openError);
      }

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
