// modules/menu-manager.js
import { Menu, app } from 'electron';
import * as browserStorage from 'electron-browser-storage';

const { localStorage } = browserStorage;
const isMac = process.platform === 'darwin';

export class MenuManager {
  constructor() {
    this.windowManager = null;
  }

  async initialize(windowManager) {
    this.windowManager = windowManager;

    await this.setupContextMenu();

    const selectedLanguage = localStorage.getItem('selectedLanguage') || 'en';
    const translations = await this.getTranslations(selectedLanguage);

    await this.createApplicationMenu(translations);
    await this.createDockMenu(translations);
  }

  // Context Menu
  async setupContextMenu() {
    const { Menu } = require('electron');
    const win = this.windowManager.getWindow();

    if (!win) return;

    const menu = Menu.buildFromTemplate([
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
      ...(isMac
        ? [
            { type: 'separator' },
            { role: 'startSpeaking' },
            { role: 'stopSpeaking' },
          ]
        : []),
    ]);

    win.webContents.on('context-menu', (_event, params) => {
      if (params.isEditable) {
        menu.popup({
          window: win,
          x: params.x,
          y: params.y,
          ...(isMac && { frame: win.webContents.mainFrame }),
        });
      }
    });
  }

  // Application Menu
  async createApplicationMenu(translations) {
    const template = this.buildMenuTemplate(translations);
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  }

  buildMenuTemplate(translations) {
    return [
      // macOS app menu
      ...(isMac ? [this.createAppMenu()] : []),

      // File menu
      this.createFileMenu(translations),

      // Edit menu
      this.createEditMenu(),

      // View menu
      this.createViewMenu(),

      // Window menu
      this.createWindowMenu(),

      // Help menu
      this.createHelpMenu(),
    ];
  }

  createAppMenu() {
    return {
      label: app.name,
      submenu: [
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    };
  }

  createFileMenu(translations) {
    return {
      label: 'File',
      submenu: [
        {
          label: translations.commands.newNote,
          accelerator: 'CmdOrCtrl+N',
          click: () => this.addNoteFromMenu(),
        },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    };
  }

  createEditMenu() {
    return {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' },
              { role: 'delete' },
              { role: 'selectAll' },
              { type: 'separator' },
              {
                label: 'Speech',
                submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }],
              },
            ]
          : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }]),
      ],
    };
  }

  createViewMenu() {
    return {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    };
  }

  createWindowMenu() {
    return {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' },
              { role: 'front' },
              { type: 'separator' },
              { role: 'window' },
            ]
          : [{ role: 'close' }]),
      ],
    };
  }

  createHelpMenu() {
    return {
      role: 'help',
      submenu: [
        {
          label: 'Docs',
          click: async () => {
            const { shell } = require('electron');
            await shell.openExternal('https://docs.beavernotes.com/');
          },
        },
      ],
    };
  }

  addNoteFromMenu() {
    if (this.windowManager) {
      this.windowManager.executeJavaScript('addNote();');
    }
  }

  // Dock Menu
  async createDockMenu(translations) {
    const dockMenu = Menu.buildFromTemplate([
      {
        label: translations.commands.newNote,
        click: () => this.addNoteFromMenu(),
      },
    ]);

    app.dock?.setMenu(dockMenu);
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
        `../../../renderer/src/pages/settings/locales/${lang}.json`
      );
      return fallback.default;
    }
  }
}
