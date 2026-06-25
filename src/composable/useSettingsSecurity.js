import { computed, onMounted, ref } from 'vue';
import {
  migrateAssetEncryption,
  onAssetMigrationProgress,
} from '@/lib/native/security';
import { useStorage } from '@/composable/storage.js';
import {
  isEncryptionEnabled,
  isKeyLoaded,
  setupEncryption,
  disableEncryption,
  encryptionIsConfigured,
  verifyPassphrase,
} from '@/utils/crypto/encryption.js';

export function useSettingsSecurity({
  dialog,
  noteStore,
  passwordStore,
  translations,
  showDialogAlert,
}) {
  const settingsStorage = useStorage('settings');
  const encryptionEnabled = ref(isEncryptionEnabled());
  const keyLoaded = ref(isKeyLoaded());
  const encryptionBusy = ref(false);
  const unlockBusy = ref(false);
  const encryptionProgress = ref({
    phase: '',
    processed: 0,
    total: 0,
  });
  const encryptionError = ref('');
  const passphraseInput = ref('');
  const passwordInput = ref('');
  const securityError = ref('');
  const hasPassword = ref(!!passwordStore.sharedKey);

  const encryptionProgressPercent = computed(() => {
    const total = encryptionProgress.value.total || 0;
    if (!total) return 0;
    return Math.min(
      100,
      Math.floor((encryptionProgress.value.processed / total) * 100)
    );
  });

  const encryptionProgressLabel = computed(() => {
    switch (encryptionProgress.value.phase) {
      case 'decrypt':
        return 'Decrypting existing notes';
      case 'encrypt':
        return 'Encrypting notes';
      case 'plaintext':
        return 'Saving plaintext notes';
      case 'assets-encrypt':
        return 'Encrypting assets';
      case 'assets-plaintext':
        return 'Saving plaintext assets';
      default:
        return 'Processing notes';
    }
  });

  async function resetPasswordDialog() {
    dialog.prompt({
      title: translations.value.settings.resetPasswordTitle,
      okText: translations.value.settings.next,
      cancelText: translations.value.settings.cancel,
      placeholder: translations.value.settings.password,
      onConfirm: async (currentPassword) => {
        if (!currentPassword) {
          showDialogAlert(translations.value.settings.invalidPassword);
          return;
        }

        const isCurrentPasswordValid = await passwordStore.isValidPassword(
          currentPassword
        );
        if (!isCurrentPasswordValid) {
          showDialogAlert(translations.value.settings.wrongCurrentPassword);
          return;
        }

        dialog.prompt({
          title: translations.value.settings.enterNewPassword,
          okText: translations.value.settings.resetPassword,
          body: translations.value.settings.warning,
          cancelText: translations.value.settings.cancel,
          placeholder: translations.value.settings.newPassword,
          onConfirm: async (newPassword) => {
            if (!newPassword) {
              showDialogAlert(translations.value.settings.invalidPassword);
              return;
            }

            try {
              await passwordStore.resetPassword(currentPassword, newPassword);
              await verifyPassphrase(newPassword);
              hasPassword.value = true;
              showDialogAlert(translations.value.settings.passwordResetSuccess);
            } catch (error) {
              console.error('Error resetting password:', error);
              showDialogAlert(translations.value.settings.passwordResetError);
            }
          },
        });
      },
    });
  }

  async function setGlobalPassword() {
    securityError.value = '';
    if (!passwordInput.value?.trim()) return;

    try {
      await passwordStore.setSharedKey(passwordInput.value);
      await verifyPassphrase(passwordInput.value);
      hasPassword.value = true;
      passwordInput.value = '';
    } catch (error) {
      securityError.value = String(error);
    }
  }

  function changePasswordDialog() {
    void resetPasswordDialog();
  }

  function refreshKeyLoaded() {
    keyLoaded.value = isKeyLoaded();
  }

  function updateEncryptionProgress(progress) {
    encryptionProgress.value = {
      phase: progress.phase,
      processed: progress.processed,
      total: progress.total,
    };
  }

  async function migrateAssetsForEncryption({ encryptAtRest }) {
    const phase = encryptAtRest ? 'assets-encrypt' : 'assets-plaintext';
    updateEncryptionProgress({
      phase,
      processed: 0,
      total: 0,
    });

    let total = 0;
    const unlisten = await onAssetMigrationProgress((event) => {
      const payload = event?.payload ?? event;
      if (payload) {
        total = payload.total || total;
        updateEncryptionProgress({
          phase,
          processed: payload.processed || 0,
          total,
        });
      }
    });

    try {
      const result = await migrateAssetEncryption(encryptAtRest);
      updateEncryptionProgress({
        phase,
        processed: result.processed,
        total: result.total,
      });

      if (result.failedPaths.length > 0) {
        throw new Error(
          `Failed to migrate ${result.failedPaths.length} asset file(s) during encryption update.`
        );
      }
    } finally {
      if (typeof unlisten === 'function') unlisten();
    }
  }

  async function runEncryptionMigration({ encryptAtRest }) {
    encryptionBusy.value = true;
    encryptionProgress.value = {
      phase: 'decrypt',
      processed: 0,
      total: 0,
    };

    const startedAt = Date.now();
    try {
      await settingsStorage.set('app_encryption_migration', {
        status: 'in_progress',
        mode: encryptAtRest ? 'encrypt' : 'decrypt',
        startedAt,
        updatedAt: startedAt,
      });

      await noteStore.decryptAllNotesForAppEncryption({
        onProgress: updateEncryptionProgress,
      });

      if (encryptAtRest) {
        await noteStore.persistAllNotesForAppEncryption({
          onProgress: updateEncryptionProgress,
        });
      } else {
        await noteStore.persistAllNotesPlaintext({
          onProgress: updateEncryptionProgress,
        });
      }

      await migrateAssetsForEncryption({ encryptAtRest });
      await settingsStorage.set('app_encryption_migration', {
        status: 'done',
        mode: encryptAtRest ? 'encrypt' : 'decrypt',
        startedAt,
        updatedAt: Date.now(),
      });
    } catch (error) {
      await settingsStorage.set('app_encryption_migration', {
        status: 'error',
        mode: encryptAtRest ? 'encrypt' : 'decrypt',
        startedAt,
        updatedAt: Date.now(),
        error: error?.message || String(error),
      });
      throw error;
    } finally {
      encryptionBusy.value = false;
    }
  }

  async function toggleEncryption(enabled) {
    if (encryptionBusy.value) return;
    encryptionError.value = '';
    const shouldEnable =
      typeof enabled === 'boolean' ? enabled : encryptionEnabled.value;
    encryptionEnabled.value = shouldEnable;

    if (shouldEnable) {
      try {
        const alreadySetUp = await encryptionIsConfigured();
        if (!alreadySetUp) {
          refreshKeyLoaded();
          return;
        }
        refreshKeyLoaded();
      } catch (error) {
        encryptionEnabled.value = isEncryptionEnabled();
        refreshKeyLoaded();
        encryptionError.value = error?.message || String(error);
      }
      return;
    }

    try {
      if (!keyLoaded.value) {
        encryptionEnabled.value = true;
        encryptionError.value =
          'Unlock encryption before disabling so notes can be saved in plain form.';
        return;
      }
      await runEncryptionMigration({ encryptAtRest: false });
      await disableEncryption();
      refreshKeyLoaded();
      encryptionEnabled.value = false;
      passphraseInput.value = '';
    } catch (error) {
      encryptionEnabled.value = true;
      refreshKeyLoaded();
      encryptionError.value = error?.message || String(error);
    }
  }

  async function confirmEncryption() {
    if (encryptionBusy.value || unlockBusy.value) return;
    encryptionError.value = '';
    const pass = passphraseInput.value;
    if (!pass) return;

    try {
      unlockBusy.value = true;
      const alreadySetUp = await encryptionIsConfigured();
      let result;

      if (alreadySetUp) {
        result = await verifyPassphrase(pass);
        if (!result.ok) {
          encryptionError.value = result.error;
          return;
        }
        await runEncryptionMigration({ encryptAtRest: true });
      } else {
        result = await setupEncryption(pass);
        if (!result.ok) {
          encryptionError.value = result.error;
          return;
        }
        await runEncryptionMigration({ encryptAtRest: true });
      }

      refreshKeyLoaded();
      passphraseInput.value = '';
      encryptionEnabled.value = true;
    } catch (error) {
      refreshKeyLoaded();
      encryptionError.value = String(error);
    } finally {
      unlockBusy.value = false;
    }
  }

  onMounted(() => {
    refreshKeyLoaded();
  });

  return {
    encryptionEnabled,
    keyLoaded,
    encryptionBusy,
    unlockBusy,
    encryptionProgress,
    encryptionProgressPercent,
    encryptionProgressLabel,
    encryptionError,
    passphraseInput,
    passwordInput,
    securityError,
    hasPassword,
    resetPasswordDialog,
    setGlobalPassword,
    changePasswordDialog,
    toggleEncryption,
    confirmEncryption,
    refreshKeyLoaded,
  };
}
