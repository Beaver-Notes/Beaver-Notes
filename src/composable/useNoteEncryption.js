import { useDialog } from '@/composable/dialog';
import { usePasswordStore } from '@/store/passwd';
import { useNoteStore } from '@/store/note';
import { useTranslations } from '@/composable/useTranslations';
import { isAppEncryptedContent } from '@/utils/appCrypto';
import { decryptNoteForMemory } from '@/utils/noteSerializer.js';
import { unlockEnabledEncryptionScopes } from '@/utils/encryptionCoordinator.js';

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
    const hassharedKey = await passwordStore.retrieve();

    if (!hassharedKey) {
      dialog.prompt({
        title: translations.value.card.enterPasswd,
        okText: translations.value.card.unlock,
        cancelText: translations.value.card.cancel,
        placeholder: translations.value.card.password,
        onConfirm: async (enteredPassword) => {
          try {
            await noteStore.unlockNote(note, enteredPassword);
            await passwordStore.setsharedKey(enteredPassword);
            await unlockEnabledEncryptionScopes(enteredPassword);
          } catch {
            dialog.alert({
              title: translations.value.settings?.alertTitle || 'Alert',
              body: translations.value.card.wrongPasswd,
              okText: translations.value.dialog?.close || 'Close',
            });
          }
        },
      });
    } else {
      const isValidPassword = await passwordStore.isValidPassword(hassharedKey);
      if (isValidPassword) {
        await noteStore.unlockNote(note, hassharedKey);
      }
    }
  }

  async function unlockAppEncryption() {
    const password = await passwordStore.retrieve();

    if (password) {
      await unlockEnabledEncryptionScopes(password);
      const current = noteStore.getById(noteId.value);
      if (current && isAppEncryptedContent(current.content)) {
        const decrypted = await decryptNoteForMemory(current);
        if (decrypted !== current) {
          noteStore.data[noteId.value] = decrypted;
        }
      }
    }
  }

  return { unlockNote, unlockAppEncryption };
}
