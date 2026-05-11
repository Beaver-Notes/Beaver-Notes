import { useDialog } from '@/composable/dialog';
import { usePasswordStore } from '@/store/passwd';
import { useNoteStore } from '@/store/note';
import { useTranslations } from '@/composable/useTranslations';
import {
  isEncryptedContent,
  isEncryptionEnabled,
  isKeyLoaded,
  verifyPassphrase,
} from '@/utils/encryption.js';
import { decryptNoteForMemory } from '@/utils/noteSerializer.js';

/**
 * Composable that handles per-note password locking and app-level
 * encryption unlocking flows.
 */
export function useNoteEncryption({ noteId, appEncryptedLocked }) {
  const dialog = useDialog();
  const passwordStore = usePasswordStore();
  const noteStore = useNoteStore();
  const { translations } = useTranslations();

  async function unlockNote(note) {
    dialog.prompt({
      title: translations.value.card.enterPasswd,
      okText: translations.value.card.unlock,
      cancelText: translations.value.card.cancel,
      placeholder: translations.value.card.password,
      onConfirm: async (enteredPassword) => {
        try {
          const hassharedKey = await passwordStore.retrieve();
          if (!hassharedKey) {
            await noteStore.unlockNote(note, enteredPassword);
            await passwordStore.setSharedKey(enteredPassword);
            if (!isEncryptionEnabled() || isKeyLoaded()) {
              await verifyPassphrase(enteredPassword);
            }
          } else {
            const isValidPassword = await passwordStore.isValidPassword(
              enteredPassword
            );
            if (isValidPassword) {
              await noteStore.unlockNote(note, enteredPassword);
            } else {
              dialog.alert({
                title: translations.value.settings?.alertTitle || 'Alert',
                body: translations.value.card.wrongPasswd,
                okText: translations.value.dialog?.close || 'Close',
              });
            }
          }
        } catch {
          dialog.alert({
            title: translations.value.settings?.alertTitle || 'Alert',
            body: translations.value.card.wrongPasswd,
            okText: translations.value.dialog?.close || 'Close',
          });
        }
      },
    });
  }

  async function unlockAppEncryption() {
    dialog.prompt({
      title: translations.value.settings?.unlock || 'Unlock',
      body:
        translations.value.settings?.unlockAppEncryption ||
        'Enter your encryption passphrase to unlock this note.',
      okText: translations.value.settings?.unlock || 'Unlock',
      cancelText: translations.value.dialog?.close || 'Close',
      placeholder: translations.value.settings?.password || 'Passphrase',
      onConfirm: async (passphrase) => {
        try {
          const result = await verifyPassphrase(passphrase);
          if (!result.ok) {
            dialog.alert({
              title: translations.value.settings?.alertTitle || 'Alert',
              body: result.error || 'Wrong passphrase.',
              okText: translations.value.dialog?.close || 'Close',
            });
            return;
          }
          const current = noteStore.getById(noteId.value);
          if (current && isEncryptedContent(current.content)) {
            const decrypted = await decryptNoteForMemory(current);
            if (decrypted !== current) {
              noteStore.data[noteId.value] = decrypted;
            }
          }
        } catch {
          dialog.alert({
            title: translations.value.settings?.alertTitle || 'Alert',
            body: translations.value.card.wrongPasswd,
            okText: translations.value.dialog?.close || 'Close',
          });
        }
      },
    });
  }

  return { unlockNote, unlockAppEncryption };
}
