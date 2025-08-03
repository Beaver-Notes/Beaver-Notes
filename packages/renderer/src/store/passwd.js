import { defineStore } from 'pinia';
import { useStorage } from '../composable/storage';
import bcryptjs from 'bcryptjs';
import {
  encryptString,
  decryptString,
  isEncryptionAvailable,
} from '../composable/safeStorage';
const { ipcRenderer, path } = window.electron;

const storage = useStorage();
const dataDir = await storage.get('dataDir', '', 'settings');
const filePath = path.join(dataDir, 'password.enc');
const LEGACY_STORAGE_KEY = 'sharedKey';

export const usePasswordStore = defineStore('password', {
  state: () => ({
    sharedKey: '',
  }),

  actions: {
    async fileExists(file) {
      return ipcRenderer.callMain('fs:pathExists', file);
    },

    async readEncryptedFile() {
      const exists = await this.fileExists(filePath);
      if (!exists) return null;
      const data = await ipcRenderer.callMain('fs:readFile', filePath);
      return data;
    },

    async writeEncryptedFile(data) {
      await ipcRenderer.callMain('fs:writeFile', {
        path: filePath,
        data,
        mode: 0o600,
      });
    },

    async deleteLegacyStorage() {
      console.log('Deleting legacy storage keys');
      const legacyKeys = [
        LEGACY_STORAGE_KEY,
        'sharedKey',
        'shared_password',
        'password',
      ];
      for (const key of legacyKeys) {
        await storage.delete(key);
      }
    },

    async retrieve() {
      try {
        const encryptionAvailable = await isEncryptionAvailable();

        if (!encryptionAvailable) {
          const legacyPassword = await storage.get(LEGACY_STORAGE_KEY, '');
          this.sharedKey = legacyPassword;
          return this.sharedKey;
        }

        // Encryption available
        const encryptedBase64 = await this.readEncryptedFile();

        if (!encryptedBase64) {
          // Don't fallback to legacy storage if encryption available
          this.sharedKey = '';
          return '';
        }

        const decryptedPassword = await decryptString(encryptedBase64);
        this.sharedKey = decryptedPassword;
        return decryptedPassword;
      } catch (error) {
        console.error('Error retrieving global password:', error);
        return '';
      }
    },

    async setsharedKey(password) {
      try {
        const hashedPassword = await bcryptjs.hash(password, 10);
        this.sharedKey = hashedPassword;

        const encryptionAvailable = await isEncryptionAvailable();

        if (encryptionAvailable) {
          const encrypted = await encryptString(hashedPassword);
          await this.writeEncryptedFile(encrypted);
          await this.deleteLegacyStorage();
        } else {
          await storage.set(LEGACY_STORAGE_KEY, hashedPassword);
        }
      } catch (error) {
        console.error('Error setting global password:', error);
        throw error;
      }
    },

    async isValidPassword(enteredPassword) {
      try {
        return await bcryptjs.compare(enteredPassword, this.sharedKey);
      } catch (error) {
        console.error('Error validating password:', error);
        throw error;
      }
    },

    async resetPassword(currentPassword, newPassword) {
      try {
        const isCurrentPasswordValid = await this.isValidPassword(
          currentPassword
        );
        if (!isCurrentPasswordValid) {
          throw new Error('Current password is incorrect');
        }

        const hashedNewPassword = await bcryptjs.hash(newPassword, 10);
        this.sharedKey = hashedNewPassword;

        const encryptionAvailable = await isEncryptionAvailable();

        if (encryptionAvailable) {
          const encrypted = await encryptString(hashedNewPassword);
          await this.writeEncryptedFile(encrypted);
          await this.deleteLegacyStorage();
        } else {
          await storage.set(LEGACY_STORAGE_KEY, hashedNewPassword);
        }

        return true;
      } catch (error) {
        console.error('Error resetting password:', error);
        throw error;
      }
    },
  },
});
