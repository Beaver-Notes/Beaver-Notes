// modules/window-manager.js
import { BrowserWindow, shell } from 'electron';
import windowStateKeeper from 'electron-window-state';
import { join } from 'path';
import { URL } from 'url';

export class WindowManager {
  constructor() {
    this.mainWindow = null;
    this.env = import.meta.env;
  }

  async createWindow() {
    const mainWindowState = windowStateKeeper({
      defaultWidth: 1000,
      defaultHeight: 800,
    });

    this.mainWindow = new BrowserWindow({
      show: false,
      x: mainWindowState.x,
      y: mainWindowState.y,
      width: mainWindowState.width,
      height: mainWindowState.height,
      webPreferences: {
        preload: join(__dirname, '../../preload/dist/index.cjs'),
        contextIsolation: this.env.MODE !== 'test',
        enableRemoteModule: this.env.MODE === 'test',
        nodeIntegration: true,
        spellcheck: true,
      },
    });

    mainWindowState.manage(this.mainWindow);
    this.mainWindow.setMenuBarVisibility(true);

    this.setupWindowEvents();
    await this.loadPage();

    return this.mainWindow;
  }

  setupWindowEvents() {
    this.mainWindow.on('ready-to-show', () => {
      this.mainWindow?.show();

      if (this.env.MODE === 'development') {
        this.mainWindow?.webContents.openDevTools();
      }
    });

    this.mainWindow?.webContents.setWindowOpenHandler((details) => {
      const url = details.url;
      if (url.startsWith('note://')) return;

      shell.openExternal(url);
      return { action: 'deny' };
    });
  }

  async loadPage() {
    const pageUrl =
      this.env.MODE === 'development'
        ? this.env.VITE_DEV_SERVER_URL
        : new URL(
            '../renderer/dist/index.html',
            'file://' + __dirname
          ).toString();

    await this.mainWindow.loadURL(pageUrl);
  }

  getWindow() {
    return this.mainWindow;
  }

  focusWindow() {
    if (this.mainWindow) {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }
      this.mainWindow.focus();
    }
  }

  sendToRenderer(channel, data) {
    if (
      this.mainWindow &&
      !this.mainWindow.isDestroyed() &&
      this.mainWindow.webContents &&
      !this.mainWindow.webContents.isDestroyed()
    ) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  executeJavaScript(code) {
    if (this.mainWindow && this.mainWindow.webContents) {
      return this.mainWindow.webContents.executeJavaScript(code);
    }
  }

  isLoading() {
    return this.mainWindow?.webContents.isLoading() || false;
  }
}
