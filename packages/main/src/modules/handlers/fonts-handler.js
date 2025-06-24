// modules/handlers/fonts-handler.js
import fontList from 'font-list';
import { ipcMain } from 'electron-better-ipc';

export class FontHandler {
  register(windowManager) {
    this.windowManager = windowManager;

    ipcMain.answerRenderer('get-system-fonts', async () => {
      try {
        const fonts = await fontList.getFonts();
        return fonts;
      } catch (e) {
        console.error('Error fetching system fonts:', e);
        return [];
      }
    });
  }
}
