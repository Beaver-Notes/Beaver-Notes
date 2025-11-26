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
    this.pendingQuit = false;
    this.currentVersion = null;
    this.availableVersion = null;
    this.pendingBannerData = null;
  }

  get isBusy() {
    return this.isChecking || this.isDownloading;
  }

  async initialize(windowManager) {
    if (process.env.MODE === 'development') {
      return; // Skip updater in dev
    }

    this.windowManager = windowManager;
    this.setupEventListeners();
    this.registerIPCHandlers();
    this.setupAppCloseHandlers();

    try {
      const stored = await localStorage.getItem('autoUpdateEnabled');
      this.autoUpdateEnabled = stored !== null ? JSON.parse(stored) : true;
    } catch (error) {
      console.error('Error loading auto-update preference:', error);
    }

    if (this.autoUpdateEnabled) {
      setTimeout(() => {
        this.checkForUpdates();
      }, 3000);
    }
  }

  setupAppCloseHandlers() {
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
            message: translations.settings.updateTitle,
            detail: translations.settings.updateDescription,
          });
        }
      });
    }
  }

  setupEventListeners() {
    autoUpdater.on('checking-for-update', () => {
      this.isChecking = true;
      this.isDownloading = false;
      this.sendUpdateStatus('Checking for updates...', 'checking');
    });

    autoUpdater.on('update-available', (info) => {
      this.isChecking = false;
      this.availableVersion = info.version;
      this.sendUpdateStatus(`Update available: ${info.version}`, 'available', {
        version: info.version,
      });
    });

    autoUpdater.on('update-not-available', (info) => {
      this.isChecking = false;
      this.currentVersion = info.version;
      this.sendUpdateStatus('You have the latest version', 'not-available', {
        version: info.version,
      });
    });

    autoUpdater.on('download-progress', (progress) => {
      this.isDownloading = true;
      this.isChecking = false;

      this.sendUpdateProgress({
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
      });

      this.sendUpdateStatus(
        `Downloading update... ${Math.round(progress.percent)}%`,
        'downloading',
        { progress }
      );
    });

    autoUpdater.on('update-downloaded', async (info) => {
      this.isDownloading = false;
      this.isChecking = false;

      this.sendUpdateStatus(
        `Update ready to install: ${info.version}`,
        'ready',
        { version: info.version }
      );

      if (this.pendingQuit) {
        autoUpdater.quitAndInstall();
        return;
      }

      const selectedLanguage = localStorage.getItem('selectedLanguage') || 'en';
      const translations = await this.getTranslations(selectedLanguage);

      const bannerData = {
        content: `${translations.settings.updateAvailable} ${info.version}`,
        primaryText: translations.settings.installNow,
        secondaryText: translations.settings.later,
        version: info.version,
      };

      this.showUpdateBanner(bannerData);
    });

    autoUpdater.on('error', (error) => {
      console.error('Auto-updater error:', error);
      this.isChecking = false;
      this.isDownloading = false;
      this.pendingQuit = false;

      this.sendUpdateStatus('Error checking for updates', 'error', {
        error: error.message,
      });
    });
  }

  async showUpdateBanner(bannerData) {
    const mainWindow = this.windowManager.getWindow();
    if (mainWindow && mainWindow.webContents) {
      try {
        await mainWindow.webContents.executeJavaScript(`
          if (window.handleUpdateBanner) {
            window.handleUpdateBanner(${JSON.stringify(bannerData)});
            true;
          } else {
            false;
          }
        `);
      } catch (error) {
        console.error('Error showing update banner:', error);

        this.pendingBannerData = bannerData;
      }
    } else {
      this.pendingBannerData = bannerData;
    }
  }

  registerIPCHandlers() {
    ipcMain.answerRenderer('renderer-ready', () => {
      if (this.pendingBannerData) {
        this.showUpdateBanner(this.pendingBannerData);
        this.pendingBannerData = null;
      }
      return { success: true };
    });

    ipcMain.answerRenderer('check-for-updates', async () => {
      return await this.checkForUpdates();
    });

    ipcMain.answerRenderer('download-update', () => {
      if (!this.isDownloading) {
        this.isDownloading = true;
        autoUpdater.downloadUpdate();
        return { success: true };
      }
      return { success: false, error: 'Download already in progress' };
    });

    ipcMain.answerRenderer('install-update', () => {
      autoUpdater.quitAndInstall();
      return { success: true };
    });

    ipcMain.answerRenderer('toggle-auto-update', (enabled) => {
      this.autoUpdateEnabled = enabled;

      try {
        localStorage.setItem('autoUpdateEnabled', JSON.stringify(enabled));
        return { success: true, enabled };
      } catch (error) {
        console.error('Error saving auto-update preference:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.answerRenderer('get-auto-update-status', () => {
      return this.autoUpdateEnabled;
    });

    ipcMain.answerRenderer('is-update-downloading', () => {
      return this.isDownloading;
    });

    ipcMain.answerRenderer('get-update-info', () => {
      return {
        isChecking: this.isChecking,
        isDownloading: this.isDownloading,
        currentVersion: this.currentVersion,
        availableVersion: this.availableVersion,
        autoUpdateEnabled: this.autoUpdateEnabled,
        isBusy: this.isBusy,
      };
    });
  }

  async checkForUpdates() {
    if (!this.isChecking && !this.isDownloading) {
      this.isChecking = true;
      try {
        const result = await autoUpdater.checkForUpdates();
        return { success: true, result };
      } catch (error) {
        console.error('Error checking for updates:', error);
        this.isChecking = false;
        this.sendUpdateStatus('Error checking for updates', 'error', {
          error: error.message,
        });
        return { success: false, error: error.message };
      }
    } else {
      return { success: false, error: 'Update check already in progress' };
    }
  }

  /**
   * Send update status to renderer using better-ipc
   * @param {string} message - Status message
   * @param {string} type - Status type ('checking', 'available', 'not-available', 'downloading', 'ready', 'error')
   * @param {object} extra - Additional data
   */
  async sendUpdateStatus(message, type, extra = {}) {
    const statusData = {
      message,
      type,
      timestamp: new Date().toISOString(),
      ...extra,
    };

    try {
      await ipcMain.callFocusedRenderer('update-status-changed', statusData);
    } catch (error) {
      console.error('Error sending update status to renderer:', error);
    }
  }

  /**
   * Send update progress to renderer using better-ipc
   * @param {object} progress - Progress data
   */
  async sendUpdateProgress(progress) {
    try {
      await ipcMain.callFocusedRenderer('update-progress-changed', progress);
    } catch (error) {
      console.error('Error sending update progress to renderer:', error);
    }
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
        `../../../renderer/src/assets/locales/${lang}.json`
      );
      return translations.default;
    } catch (error) {
      console.error(
        `Failed to load translations for ${lang}, falling back to English.`,
        error
      );

      const fallback = await import(
        `../../../renderer/src/assets/locales/en.json`
      );
      return fallback.default;
    }
  }
}
