import { defineStore } from 'pinia';
import * as CryptoJS from 'crypto-es';
import {
  encryptString,
  decryptString,
  isEncryptionAvailable,
} from '../composable/safeStorage';
import { useStorage } from '../composable/storage';
import { useNoteStore } from './note';
import {
  setupSyncEncryption,
  verifySyncPassphrase,
  syncFolderHasEncryption,
  isSyncEncryptionEnabled,
  isSyncKeyLoaded,
} from '../utils/syncCrypto.js';
import {
  setupAppEncryption,
  verifyAppPassphrase,
  appFolderHasEncryption,
  isAppEncryptionEnabled,
  isAppKeyLoaded,
} from '../utils/appCrypto.js';
import { getSyncPath } from '../utils/syncPath.js';
import { path } from '@/lib/tauri-bridge';
import { pathExists, readFile, writeFile } from '@/lib/native/fs';
import {
  comparePassword,
  hashPassword,
  recordPasswordFailure,
  resetPasswordFailures,
} from '@/lib/native/security';

const { SHA256, algo, PBKDF2 } = CryptoJS;
const storage = useStorage();

const LEGACY_STORAGE_KEY = 'sharedKey';

async function _getPasswordFilePath() {
  const dataDir = await storage.get('dataDir', '', 'settings');
  if (!dataDir) return null;
  return path.join(dataDir, 'password.enc');
}

async function _mirrorToEncryptionSystems(plainPassword) {
  try {
    if (isAppEncryptionEnabled()) {
      if (!isAppKeyLoaded()) {
        const alreadyInit = await appFolderHasEncryption();
        if (alreadyInit) {
          await verifyAppPassphrase(plainPassword);
        } else {
          await setupAppEncryption(plainPassword);
        }
      }
    }
  } catch (err) {
    console.warn('[passwd] app encryption mirror failed (non-fatal):', err);
  }
  try {
    const syncPath = await getSyncPath();
    if (!syncPath) return;

    const folderHasEncryption = await syncFolderHasEncryption();

    if (folderHasEncryption) {
      if (!isSyncKeyLoaded()) {
        await verifySyncPassphrase(plainPassword);
      }
    } else if (isSyncEncryptionEnabled()) {
      await setupSyncEncryption(plainPassword);
    }
  } catch (err) {
    console.warn('[passwd] sync encryption mirror failed (non-fatal):', err);
  }
}

export const usePasswordStore = defineStore('password', {
  state: () => ({
    sharedKey: '',

    _legacyDerivedKey: '',
  }),

  actions: {
    async _fileExists(file) {
      return pathExists(file);
    },

    async _readEncryptedFile() {
      const filePath = await _getPasswordFilePath();
      if (!filePath) return null;
      if (!(await this._fileExists(filePath))) return null;
      return readFile(filePath);
    },

    async _writeEncryptedFile(data) {
      const filePath = await _getPasswordFilePath();
      if (!filePath) throw new Error('Data directory not configured.');
      await writeFile(filePath, data, { mode: 0o600 });
    },

    async _deleteLegacyStorage() {
      for (const key of [
        LEGACY_STORAGE_KEY,
        'sharedKey',
        'shared_password',
        'password',
      ]) {
        await storage.delete(key);
      }
    },

    async retrieve() {
      try {
        const encryptionAvailable = await isEncryptionAvailable();

        if (encryptionAvailable) {
          const encryptedBase64 = await this._readEncryptedFile();

          if (!encryptedBase64) {
            const legacyPassword = await storage.get(LEGACY_STORAGE_KEY, '');
            if (legacyPassword) {
              await this.importSharedKey(legacyPassword);
              return this.sharedKey;
            }
            this.sharedKey = '';
            return '';
          }

          let decrypted;
          try {
            decrypted = await decryptString(encryptedBase64);
          } catch (decryptErr) {
            console.warn(
              '[passwd] password.enc could not be decrypted, falling back to legacy storage:',
              decryptErr
            );
            const legacyPassword = await storage.get(LEGACY_STORAGE_KEY, '');
            this.sharedKey = legacyPassword || '';
            return this.sharedKey;
          }

          try {
            const parsed = JSON.parse(decrypted);
            this.sharedKey = parsed.hash;
            if (parsed.key) this._legacyDerivedKey = parsed.key;
          } catch {
            this.sharedKey = decrypted;
          }

          return this.sharedKey;
        } else {
          const legacyPassword = await storage.get(LEGACY_STORAGE_KEY, '');
          this.sharedKey = legacyPassword;
          return legacyPassword;
        }
      } catch (error) {
        console.error('[passwd] retrieve failed:', error);
        return '';
      }
    },

    async setsharedKey(password) {
      try {
        const hashedPassword = await hashPassword(password);
        this.sharedKey = hashedPassword;
        this._legacyDerivedKey = ''; // clear stale legacy value

        const encryptionAvailable = await isEncryptionAvailable();
        if (encryptionAvailable) {
          const encrypted = await encryptString(
            JSON.stringify({ hash: hashedPassword })
          );
          await this._writeEncryptedFile(encrypted);
          await this._deleteLegacyStorage();
        } else {
          await storage.set(LEGACY_STORAGE_KEY, hashedPassword);
        }
        await _mirrorToEncryptionSystems(password);
      } catch (error) {
        console.error('[passwd] setsharedKey failed:', error);
        throw error;
      }
    },

    async isValidPassword(enteredPassword) {
      try {
        const valid = await comparePassword(enteredPassword, this.sharedKey);

        if (!valid && this._legacyDerivedKey) {
          const salt = SHA256(enteredPassword).toString().slice(0, 32);
          const derived = PBKDF2(enteredPassword, salt, {
            keySize: 256 / 32,
            iterations: 100000,
            hasher: algo.SHA256,
          }).toString();

          if (derived !== this._legacyDerivedKey) {
            const { warn, failCount } = await recordPasswordFailure();
            if (warn)
              console.warn(`[passwd] ${failCount} consecutive failures`);
            return false;
          }
          try {
            await this.setsharedKey(enteredPassword);
          } catch (migErr) {
            console.warn(
              '[passwd] legacy migration failed (non-fatal):',
              migErr
            );
          }
        } else if (!valid) {
          const { warn, failCount } = await recordPasswordFailure();
          if (warn) console.warn(`[passwd] ${failCount} consecutive failures`);
          return false;
        }
        await resetPasswordFailures();
        await _mirrorToEncryptionSystems(enteredPassword);

        return true;
      } catch (error) {
        console.error('[passwd] isValidPassword failed:', error);
        throw error;
      }
    },

    async resetPassword(currentPassword, newPassword) {
      const noteStore = useNoteStore();

      if (!(await this.isValidPassword(currentPassword))) {
        throw new Error('Current password is incorrect');
      }

      const lockedNotes = Object.values(noteStore.data).filter(
        (note) => note.id && note.isLocked
      );

      for (const note of lockedNotes) {
        try {
          await noteStore.unlockNote(note.id, currentPassword);
          await noteStore.lockNote(note.id, newPassword);
        } catch (err) {
          console.error(`[passwd] failed to re-encrypt note ${note.id}:`, err);
        }
      }
      await this.setsharedKey(newPassword);
      return true;
    },

    async importSharedKey(hash, derivedKey = null) {
      this.sharedKey = hash;
      this._legacyDerivedKey = derivedKey ?? '';

      const encryptionAvailable = await isEncryptionAvailable();
      if (encryptionAvailable) {
        const encrypted = await encryptString(JSON.stringify({ hash }));
        await this._writeEncryptedFile(encrypted);
        await this._deleteLegacyStorage();
      } else {
        await storage.set(LEGACY_STORAGE_KEY, hash);
      }
    },
  },
});
