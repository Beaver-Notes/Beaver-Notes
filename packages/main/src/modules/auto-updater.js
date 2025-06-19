// modules/auto-updater.js
import * as browserStorage from 'electron-browser-storage';
import { autoUpdater } from 'electron-updater';
import { ipcMain } from 'electron-better-ipc';
import { dialog } from 'electron';

const { localStorage } = browserStorage;

export class AutoUpdater {
  constructor() {
    this.autoUpdateEnabled = true;
    this.isChecking = false;
    this.isDownloading = false;
  }

  get isBusy() {
    return this.isChecking || this.isDownloading;
  }

  async initialize(windowManager) {
    this.windowManager = windowManager;
    this.setupEventListeners();
    this.registerIPCHandlers();
  }

  setupEventListeners() {
    autoUpdater.on('checking-for-update', () => {
      this.isChecking = true;
      this.windowManager.sendToRenderer(
        'update-status',
        'Checking for updates...'
      );
    });

    autoUpdater.on('update-available', (info) => {
      this.isChecking = false;
      this.windowManager.sendToRenderer(
        'update-status',
        `Update available: ${info.version}`
      );
    });

    autoUpdater.on('update-not-available', () => {
      this.isChecking = false;
      this.windowManager.sendToRenderer(
        'update-status',
        'No updates available.'
      );
    });

    autoUpdater.on('download-progress', (progress) => {
      this.isDownloading = true;
      this.windowManager.sendToRenderer('update-progress', progress);
    });

    autoUpdater.on('update-downloaded', async (info) => {
      const selectedLanguage = localStorage.getItem('selectedLanguage') || 'en';
      const translations = await this.getTranslations(selectedLanguage);
      this.isDownloading = false;
      this.windowManager.sendToRenderer(
        'update-status',
        `Update ready: ${info.version}`
      );

      const window = this.windowManager.getMainWindow(); // or however you get the main BrowserWindow
      const result = await dialog.showMessageBox(window, {
        type: 'question',
        buttons: [translations.settings.updatenow, translations.settings.later],
        defaultId: 0,
        message: `${translations.settings.updateReady} ${info.version}`,
        detail: translations.settings.restartToUpdate,
      });

      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });

    // Handle errors and reset flags
    autoUpdater.on('error', () => {
      this.isChecking = false;
      this.isDownloading = false;
    });
  }

  registerIPCHandlers() {
    ipcMain.answerRenderer('check-for-updates', async () => {
      if (this.autoUpdateEnabled && !this.isChecking) {
        this.isChecking = true;
        autoUpdater.checkForUpdates();
      }
    });

    ipcMain.answerRenderer('download-update', () => {
      if (!this.isDownloading) {
        this.isDownloading = true;
        autoUpdater.downloadUpdate();
      }
    });

    ipcMain.answerRenderer('install-update', () => {
      autoUpdater.quitAndInstall();
    });

    ipcMain.answerRenderer('toggle-auto-update', (_, enabled) => {
      this.autoUpdateEnabled = enabled;
    });

    ipcMain.answerRenderer(
      'get-auto-update-status',
      () => this.autoUpdateEnabled
    );
  }

  async getTranslations(lang = 'en') {
    const supportedLangs = [
      'en',
      'de',
      'es',
      'fr',
      'it',
      'nl',
      'tr',
      'ru',
      'uk',
      'zh',
    ];

    if (!supportedLangs.includes(lang)) lang = 'en';

    try {
      const translations = await import(
        `../../../renderer/src/pages/settings/locales/${lang}.json`
      );
      return translations.default;
    } catch (error) {
      console.error(
        `Failed to load translations for ${lang}, falling back to English.`,
        error
      );
      const fallback = await import(
        `../../../renderer/src/pages/settings/locales/${lang}.json`
      );
      return fallback.default;
    }
  }
}
