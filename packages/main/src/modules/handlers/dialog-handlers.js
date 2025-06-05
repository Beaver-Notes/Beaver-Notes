// modules/handlers/dialog-handlers.js
import { ipcMain } from 'electron-better-ipc';
import { dialog } from 'electron';

export class DialogHandlers {
  register() {
    ipcMain.answerRenderer('dialog:open', (props) =>
      dialog.showOpenDialog(props)
    );

    ipcMain.answerRenderer('dialog:message', (props) =>
      dialog.showMessageBox(props)
    );

    ipcMain.answerRenderer('dialog:save', (props) =>
      dialog.showSaveDialog(props)
    );
  }
}
