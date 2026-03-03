import { ipcMain } from 'electron-better-ipc';
import { safeStorage } from 'electron';
import Store from 'electron-store';
import bcryptjs from 'bcryptjs';
import {
  clearTransientAppPassphrase,
  setTransientAppPassphrase,
} from '../security/app-asset-crypto';

const authStore = new Store({ name: 'auth' });
const ALLOWED_BLOB_KEYS = new Set(['syncPassphraseBlob', 'appPassphraseBlob']);

let _failCount = 0;
const WARN_THRESHOLD = 5;

export class SafeStorageHandlers {
  register() {
    ipcMain.answerRenderer('safeStorage:isEncryptionAvailable', () =>
      safeStorage.isEncryptionAvailable(),
    );

    ipcMain.answerRenderer('safeStorage:encryptString', (plainText) => {
      if (!safeStorage.isEncryptionAvailable())
        throw new Error('safeStorage encryption not available');
      return safeStorage.encryptString(plainText).toString('base64');
    });

    ipcMain.answerRenderer('safeStorage:decryptString', (encryptedBase64) => {
      if (!safeStorage.isEncryptionAvailable())
        throw new Error('safeStorage decryption not available');
      return safeStorage.decryptString(Buffer.from(encryptedBase64, 'base64'));
    });

    ipcMain.answerRenderer('safeStorage:getSelectedStorageBackend', () =>
      safeStorage.getSelectedStorageBackend(),
    );


    const guardBlobKey = (key) => {
      if (!ALLOWED_BLOB_KEYS.has(key)) {
        throw new Error(`[safeStorage] Unsupported blob key: ${key}`);
      }
    };

    ipcMain.answerRenderer('safeStorage:storeBlob', ({ key, blob }) => {
      guardBlobKey(key);
      authStore.set(`blobs.${key}`, blob);
    });

    ipcMain.answerRenderer('safeStorage:fetchBlob', (key) => {
      guardBlobKey(key);
      return authStore.get(`blobs.${key}`, null);
    });

    ipcMain.answerRenderer('safeStorage:clearBlob', (key) => {
      guardBlobKey(key);
      authStore.delete(`blobs.${key}`);
    });

    ipcMain.answerRenderer('assetCrypto:setAppPassphrase', (passphrase) => {
      setTransientAppPassphrase(passphrase);
    });
    ipcMain.answerRenderer('assetCrypto:clearAppPassphrase', () => {
      clearTransientAppPassphrase();
    });


    ipcMain.answerRenderer('passwd:hash', async (password) => {
      return bcryptjs.hash(password, 10);
    });

    ipcMain.answerRenderer('passwd:compare', async ({ password, hash }) => {
      if (!hash) return false;
      try {
        return await bcryptjs.compare(password, hash);
      } catch {
        return false;
      }
    });


    ipcMain.answerRenderer('passwd:recordFailure', () => {
      _failCount++;
      return { failCount: _failCount, warn: _failCount >= WARN_THRESHOLD };
    });

    ipcMain.answerRenderer('passwd:resetFailures', () => {
      _failCount = 0;
    });
  }
}
