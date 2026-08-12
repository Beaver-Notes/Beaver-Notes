import { useDialog } from '@/lib/dialog';
import { useNoteStore } from '@/store/note';
import { useTranslations } from '@/composable/useTranslations';
import {
  isEncryptedContent,
  verifyPassphrase,
  tryRestoreKeyFromSafeStorage,
} from '@/utils/crypto/encryption.js';
import { decryptNoteForMemory } from '@/utils/note/serializer.js';
import {
  isBiometricAvailable,
  authenticateWithBiometrics,
} from '@/lib/native/biometric';
import { speed } from '@/utils/speed.js';

export function useNoteEncryption({ noteId }) {
  const dialog = useDialog();
  const noteStore = useNoteStore();
  const { translations } = useTranslations();

  async function unlockAppEncryption() {
    const t_ = speed('note_unlock_encryption');
    const biometricOk = await isBiometricAvailable();
    if (biometricOk) {
      try {
        await authenticateWithBiometrics('Unlock note');
        const restored = await tryRestoreKeyFromSafeStorage();
        if (restored) {
          const current = noteStore.getById(noteId.value);
          if (current && isEncryptedContent(current.content)) {
            const decrypted = await decryptNoteForMemory(current);
            if (decrypted !== current) {
              noteStore.data[noteId.value] = decrypted;
            }
          }
          t_?.end();
          return;
        }
      } catch {
        // fall through to passphrase dialog
      }
    }

    const t = translations.value;
    dialog.prompt({
      title: t.settings?.unlock || 'Unlock',
      body:
        t.settings?.unlockAppEncryption ||
        'Enter your encryption passphrase to unlock this note.',
      okText: t.settings?.unlock || 'Unlock',
      cancelText: t.dialog?.close || 'Close',
      placeholder: t.settings?.password || 'Passphrase',
      onConfirm: async (passphrase) => {
        try {
          const result = await verifyPassphrase(passphrase);
          if (!result.ok) {
            dialog.alert({
              title: t.settings?.alertTitle || 'Alert',
              body: result.error || 'Wrong passphrase.',
              okText: t.dialog?.close || 'Close',
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
            title: t.settings?.alertTitle || 'Alert',
            body: t.card?.wrongPasswd || 'Wrong passphrase.',
            okText: t.dialog?.close || 'Close',
          });
        }
      },
    });
  }

  return { unlockAppEncryption };
}
