// modules/auto-updater.js
import * as browserStorage from 'electron-browser-storage';
import { autoUpdater } from 'electron-updater';
import { ipcMain } from 'electron-better-ipc';
import { dialog, app } from 'electron';
const { localStorage } = browserStorage;

export class AutoUpdater {
  constructor() {
    this.autoUpdateEnabled = true;
    this.isChecking = false;
    this.isDownloading = false;
    this.pendingQuit = false;
  }

  get isBusy() {
    return this.isChecking || this.isDownloading;
  }

  async initialize(windowManager) {
    this.windowManager = windowManager;
    this.setupEventListeners();
    this.registerIPCHandlers();
    this.setupAppCloseHandlers();
  }

  setupAppCloseHandlers() {
    app.on('before-quit', async (event) => {
      if (this.isDownloading) {
        event.preventDefault();
        this.pendingQuit = true;

        const selectedLanguage =
          localStorage.getItem('selectedLanguage') || 'en';
        const translations = await this.getTranslations(selectedLanguage);

        const window = this.windowManager.getWindow();
        await dialog.showMessageBox(window, {
          type: 'info',
          buttons: ['OK'],
          message: translations.settings.updateDownloading,
          detail: translations.settings.updateDownloadingMessage,
        });
      }
    });

    const window = this.windowManager.getWindow();
    if (window) {
      window.on('close', async (event) => {
        if (this.isDownloading) {
          event.preventDefault();
          this.pendingQuit = true;

          const selectedLanguage =
            localStorage.getItem('selectedLanguage') || 'en';
          const translations = await this.getTranslations(selectedLanguage);

          await dialog.showMessageBox(window, {
            type: 'info',
            buttons: ['OK'],
            message: translations.settings.updateDownloading,
            detail: translations.settings.updateDownloadingMessage,
          });
        }
      });
    }
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

      // If user tried to quit during download, quit automatically now
      if (this.pendingQuit) {
        autoUpdater.quitAndInstall();
        return;
      }

      const window = this.windowManager.getWindow();
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
    autoUpdater.on('error', (error) => {
      console.error('Auto-updater error:', error);
      this.isChecking = false;
      this.isDownloading = false;
      this.pendingQuit = false;
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

    // New handler to check if update is downloading
    ipcMain.answerRenderer('is-update-downloading', () => {
      return this.isDownloading;
    });
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
      // Fixed: Use 'en' as fallback instead of the same failed language
      const fallback = await import(
        `../../../renderer/src/pages/settings/locales/en.json`
      );
      return fallback.default;
    }
  }
}
