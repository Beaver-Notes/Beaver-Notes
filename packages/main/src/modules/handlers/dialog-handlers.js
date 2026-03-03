// modules/handlers/dialog-handlers.js
import { ipcMain } from 'electron-better-ipc';
import { dialog } from 'electron';
import { grantTrustedDialogPaths } from '../security/fs-access';

export class DialogHandlers {
  register() {
    ipcMain.answerRenderer('dialog:open', async (props) => {
      const result = await dialog.showOpenDialog(props);
      if (!result.canceled) grantTrustedDialogPaths(result.filePaths);
      return result;
    });

    ipcMain.answerRenderer('dialog:message', (props) =>
      dialog.showMessageBox(props)
    );

    ipcMain.answerRenderer('dialog:save', async (props) => {
      const result = await dialog.showSaveDialog(props);
      if (!result.canceled && result.filePath) {
        grantTrustedDialogPaths([result.filePath]);
      }
      return result;
    });
  }
}
