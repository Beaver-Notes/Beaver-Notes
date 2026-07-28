import { useDialog } from '@/composable/dialog';
import { useNoteStore } from '@/store/note';
import { useTranslations } from '@/composable/useTranslations';
import {
  isEncryptedContent,
  verifyPassphrase,
} from '@/utils/crypto/encryption.js';
import { decryptNoteForMemory } from '@/utils/note/serializer.js';

export function useNoteEncryption({ noteId }) {
  const dialog = useDialog();
  const noteStore = useNoteStore();
  const { translations } = useTranslations();

  async function unlockAppEncryption() {
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
