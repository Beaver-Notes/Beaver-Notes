import { onMounted, ref } from 'vue';
import {
  isKeyLoaded,
  setupEncryption,
  verifyPassphrase,
  lockEncryptionKey,
} from '@/utils/crypto/encryption.js';

export function useSettingsSecurity({
  dialog,
  _noteStore,
  translations,
}) {
  const keyLoaded = ref(isKeyLoaded());
  const encryptionBusy = ref(false);
  const encryptionError = ref('');
  const passwordInput = ref('');
  const securityError = ref('');

  function changePasswordDialog() {
    void changeEncryptionPassphrase();
  }

  function refreshKeyLoaded() {
    keyLoaded.value = isKeyLoaded();
  }

  async function changeEncryptionPassphrase() {
    if (encryptionBusy.value) return;
    encryptionError.value = '';

    dialog.prompt({
      title:
        translations.value.settings.changePassphrase ||
        'Change Encryption Passphrase',
      body:
        translations.value.settings.changePassphraseDesc ||
        'Enter your current passphrase to change it. The underlying encryption key will be re-wrapped — your notes are not re-encrypted.',
      icon: 'riLockLine',
      okText: translations.value.settings.next || 'Next',
      cancelText: translations.value.settings.cancel || 'Cancel',
      placeholder:
        translations.value.settings.currentPassphrase || 'Current passphrase',
      onConfirm: async (currentPass) => {
        if (!currentPass) return;

        try {
          const result = await verifyPassphrase(currentPass);
          if (!result.ok) {
            encryptionError.value = result.error || 'Incorrect passphrase.';
            return;
          }

          dialog.prompt({
            title:
              translations.value.settings.enterNewPassphrase ||
              'Enter New Passphrase',
            body:
              translations.value.settings.newPassphraseDesc ||
              'Choose a new passphrase. This will re-wrap your encryption key.',
            icon: 'riLockLine',
            okText: translations.value.settings.setPassword || 'Set passphrase',
            cancelText: translations.value.settings.cancel || 'Cancel',
            placeholder:
              translations.value.settings.newPassphrase || 'New passphrase',
            onConfirm: async (newPass) => {
              if (!newPass) return;
              if (newPass.length < 6) {
                encryptionError.value =
                  'Passphrase must be at least 6 characters.';
                return;
              }

              dialog.prompt({
                title:
                  translations.value.settings.confirmPassphrase ||
                  'Confirm Passphrase',
                icon: 'riLockLine',
                okText:
                  translations.value.settings.setPassword || 'Set passphrase',
                cancelText: translations.value.settings.cancel || 'Cancel',
                placeholder:
                  translations.value.settings.confirmPassphrasePlaceholder ||
                  'Confirm passphrase',
                onConfirm: async (confirmPass) => {
                  if (newPass !== confirmPass) {
                    encryptionError.value = 'Passphrases do not match.';
                    return;
                  }

                  try {
                    encryptionBusy.value = true;
                    const setupResult = await setupEncryption(newPass);
                    if (!setupResult.ok) {
                      encryptionError.value =
                        setupResult.error || 'Failed to change passphrase.';
                      return;
                    }
                    encryptionError.value = '';
                    dialog.alert({
                      title:
                        translations.value.settings.passphraseChanged ||
                        'Passphrase Changed',
                      body:
                        translations.value.settings.passphraseChangedDesc ||
                        'Your encryption passphrase has been updated.',
                      okText: translations.value.dialog?.close || 'Close',
                    });
                  } catch (e) {
                    encryptionError.value = String(e);
                  } finally {
                    encryptionBusy.value = false;
                  }
                },
              });
            },
          });
        } catch (e) {
          encryptionError.value = String(e);
        }
      },
    });
  }

  function lockNow() {
    lockEncryptionKey();
    keyLoaded.value = false;
  }

  onMounted(() => {
    refreshKeyLoaded();
  });

  return {
    keyLoaded,
    encryptionBusy,
    encryptionError,
    passwordInput,
    securityError,
    changePasswordDialog,
    changeEncryptionPassphrase,
    lockNow,
    refreshKeyLoaded,
  };
}
