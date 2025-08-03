import { ipcMain } from 'electron-better-ipc';
import { safeStorage } from 'electron';

export class SafeStorageHandlers {
  register() {
    ipcMain.answerRenderer('safeStorage:isEncryptionAvailable', () => {
      return safeStorage.isEncryptionAvailable();
    });

    ipcMain.answerRenderer('safeStorage:encryptString', (plainText) => {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('safeStorage encryption not available');
      }
      const encryptedBuffer = safeStorage.encryptString(plainText);
      return encryptedBuffer.toString('base64');
    });

    ipcMain.answerRenderer('safeStorage:decryptString', (encryptedBase64) => {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('safeStorage decryption not available');
      }
      const encryptedBuffer = Buffer.from(encryptedBase64, 'base64');
      return safeStorage.decryptString(encryptedBuffer);
    });

    ipcMain.answerRenderer('safeStorage:getSelectedStorageBackend', () => {
      return safeStorage.getSelectedStorageBackend();
    });
  }
}
