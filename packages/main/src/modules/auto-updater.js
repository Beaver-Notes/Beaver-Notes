// modules/auto-updater.js
import { autoUpdater } from 'electron-updater';
import { ipcMain } from 'electron-better-ipc';

export class AutoUpdater {
  constructor() {
    this.autoUpdateEnabled = true;
  }

  async initialize(windowManager) {
    this.windowManager = windowManager;
    this.setupEventListeners();
    this.registerIPCHandlers();
  }

  setupEventListeners() {
    autoUpdater.on('checking-for-update', () => {
      this.windowManager.sendToRenderer('update-status', 'Checking for updates...');
    });

    autoUpdater.on('update-available', (info) => {
      this.windowManager.sendToRenderer('update-status', `Update available: ${info.version}`);
    });

    autoUpdater.on('update-not-available', () => {
      this.windowManager.sendToRenderer('update-status', 'No updates available.');
    });

    autoUpdater.on('download-progress', (progress) => {
      this.windowManager.sendToRenderer('update-progress', progress);
    });

    autoUpdater.on('update-downloaded', (info) => {
      this.windowManager.sendToRenderer('update-status', `Update ready: ${info.version}`);
    });
  }

  registerIPCHandlers() {
    ipcMain.answerRenderer('check-for-updates', async () => {
      if (this.autoUpdateEnabled) {
        autoUpdater.checkForUpdates();
      }
    });

    ipcMain.answerRenderer('download-update', () => {
      autoUpdater.downloadUpdate();
    });

    ipcMain.answerRenderer('install-update', () => {
      autoUpdater.quitAndInstall();
    });

    ipcMain.answerRenderer('toggle-auto-update', (_, enabled) => {
      this.autoUpdateEnabled = enabled;
    });

    ipcMain.answerRenderer('get-auto-update-status', () => this.autoUpdateEnabled);
  }
}