import { defineStore } from 'pinia';
import {
  encryptString,
  decryptString,
  isEncryptionAvailable,
} from '@/lib/native/security';
import { useNoteStore } from './note';
import { path } from '@/lib/tauri-bridge';
import { getAppDirectory } from '@/lib/native/app';
import { pathExists, readFile, writeFile } from '@/lib/native/fs';
import {
  comparePassword,
  hashPassword,
  recordPasswordFailure,
  resetPasswordFailures,
} from '@/lib/native/security';

async function _getPasswordFilePath() {
  const appDirectory = await getAppDirectory();
  if (!appDirectory) return null;
  return path.join(appDirectory, 'password.enc');
}

export const usePasswordStore = defineStore('password', {
  state: () => ({
    sharedKey: '',
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

    async retrieve() {
      try {
        const encryptionAvailable = await isEncryptionAvailable();

        if (encryptionAvailable) {
          const encryptedBase64 = await this._readEncryptedFile();

          if (!encryptedBase64) {
            this.sharedKey = '';
            return '';
          }

          // If the file content is a raw bcrypt hash (legacy format), use it directly
          const trimmed = encryptedBase64.trim();
          if (
            trimmed.startsWith('$2a$') ||
            trimmed.startsWith('$2b$') ||
            trimmed.startsWith('$2y$')
          ) {
            this.sharedKey = trimmed;
            return this.sharedKey;
          }

          try {
            const decrypted = await decryptString(encryptedBase64);
            try {
              const parsed = JSON.parse(decrypted);
              this.sharedKey = parsed.hash || decrypted;
            } catch {
              this.sharedKey = decrypted;
            }
            return this.sharedKey;
          } catch {
            // Decryption failed — treat raw content as hash if it looks like one
            this.sharedKey = trimmed;
            return this.sharedKey;
          }
        } else {
          this.sharedKey = '';
          return '';
        }
      } catch (error) {
        console.error('[passwd] retrieve failed:', error);
        this.sharedKey = '';
        return '';
      }
    },

    async setSharedKey(password) {
      try {
        const hashedPassword = await hashPassword(password);
        this.sharedKey = hashedPassword;

        const encryptionAvailable = await isEncryptionAvailable();
        if (encryptionAvailable) {
          const encrypted = await encryptString(
            JSON.stringify({ hash: hashedPassword })
          );
          await this._writeEncryptedFile(encrypted);
        }
      } catch (error) {
        console.error('[passwd] setSharedKey failed:', error);
        throw error;
      }
    },

    async isValidPassword(enteredPassword) {
      try {
        const valid = await comparePassword(enteredPassword, this.sharedKey);

        if (!valid) {
          const { warn, failCount } = await recordPasswordFailure();
          if (warn) console.warn(`[passwd] ${failCount} consecutive failures`);
          return false;
        }

        await resetPasswordFailures();
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
      await this.setSharedKey(newPassword);
      return true;
    },

    async importSharedKey(rawHash) {
      if (!rawHash || typeof rawHash !== 'string') return;
      const trimmed = rawHash.trim();
      const isBcryptHash =
        trimmed.startsWith('$2a$') ||
        trimmed.startsWith('$2b$') ||
        trimmed.startsWith('$2y$');

      if (!isBcryptHash) {
        // Plaintext password — hash and persist through the canonical path
        return this.setSharedKey(trimmed);
      }

      // Already a bcrypt hash — store in memory and persist to disk
      this.sharedKey = trimmed;
      try {
        const encryptionAvailable = await isEncryptionAvailable();
        if (encryptionAvailable) {
          const encrypted = await encryptString(
            JSON.stringify({ hash: trimmed })
          );
          await this._writeEncryptedFile(encrypted);
        }
      } catch (error) {
        console.error('[passwd] importSharedKey persist failed:', error);
      }
    },
  },
});
