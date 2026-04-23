import { computed, onMounted, ref } from 'vue';
import { migrateAssetEncryption } from '@/lib/native/security';
import { useStorage } from '@/composable/storage.js';
import {
  isSyncEncryptionEnabled,
  isSyncKeyLoaded,
  syncFolderHasEncryption,
  setupSyncEncryption,
  disableSyncEncryption,
} from '@/utils/sync/crypto.js';
import {
  isAppEncryptionEnabled,
  isAppKeyLoaded,
  setupAppEncryption,
  disableAppEncryption,
  appFolderHasEncryption,
} from '@/utils/appCrypto.js';
import { unlockEnabledEncryptionScopes } from '@/utils/encryptionCoordinator.js';

export function useSettingsSecurity({
  dialog,
  noteStore,
  passwordStore,
  translations,
  getEffectiveDataDir,
  showDialogAlert,
}) {
  const settingsStorage = useStorage('settings');
  const syncEncryptionEnabled = ref(isSyncEncryptionEnabled());
  const syncKeyLoaded = ref(isSyncKeyLoaded());
  const syncPassphraseInput = ref('');
  const syncCryptoError = ref('');
  const syncUnlockBusy = ref(false);
  const appEncryptionEnabled = ref(isAppEncryptionEnabled());
  const appKeyLoaded = ref(isAppKeyLoaded());
  const appEncryptionBusy = ref(false);
  const appUnlockBusy = ref(false);
  const appEncryptionProgress = ref({
    phase: '',
    processed: 0,
    total: 0,
  });
  const appEncryptionError = ref('');
  const appConfirmInput = ref('');
  const passwordInput = ref('');
  const securityError = ref('');
  const hasPassword = ref(!!passwordStore.sharedKey);

  const appEncryptionProgressPercent = computed(() => {
    const total = appEncryptionProgress.value.total || 0;
    if (!total) return 0;
    return Math.min(
      100,
      Math.floor((appEncryptionProgress.value.processed / total) * 100)
    );
  });

  const appEncryptionProgressLabel = computed(() => {
    switch (appEncryptionProgress.value.phase) {
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

  async function hydrateSyncEncryptionState() {
    const folderEncrypted = await syncFolderHasEncryption();
    if (folderEncrypted) {
      syncEncryptionEnabled.value = true;
    } else {
      syncEncryptionEnabled.value = isSyncEncryptionEnabled();
    }
    syncKeyLoaded.value = isSyncKeyLoaded();
  }

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
              await unlockEnabledEncryptionScopes(newPassword);
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
      await passwordStore.setsharedKey(passwordInput.value);
      await unlockEnabledEncryptionScopes(passwordInput.value);
      hasPassword.value = true;
      passwordInput.value = '';
    } catch (error) {
      securityError.value = String(error);
    }
  }

  function changePasswordDialog() {
    void resetPasswordDialog();
  }

  function refreshAppKeyLoaded() {
    appKeyLoaded.value = isAppKeyLoaded();
  }

  function updateAppEncryptionProgress(progress) {
    appEncryptionProgress.value = {
      phase: progress.phase,
      processed: progress.processed,
      total: progress.total,
    };
  }

  async function migrateAssetsForAppEncryption({ encryptAtRest }) {
    const dataDir = await getEffectiveDataDir();
    if (!dataDir) return;
    const phase = encryptAtRest ? 'assets-encrypt' : 'assets-plaintext';
    updateAppEncryptionProgress({
      phase,
      processed: 0,
      total: 0,
    });

    const result = await migrateAssetEncryption(dataDir, encryptAtRest);
    updateAppEncryptionProgress({
      phase,
      processed: result.processed,
      total: result.total,
    });

    if (result.failedPaths.length > 0) {
      throw new Error(
        `Failed to migrate ${result.failedPaths.length} asset file(s) during app-encryption update.`
      );
    }
  }

  async function runAppEncryptionMigration({ encryptAtRest }) {
    appEncryptionBusy.value = true;
    appEncryptionProgress.value = {
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
        onProgress: updateAppEncryptionProgress,
      });

      if (encryptAtRest) {
        await noteStore.persistAllNotesForAppEncryption({
          onProgress: updateAppEncryptionProgress,
        });
      } else {
        await noteStore.persistAllNotesPlaintext({
          onProgress: updateAppEncryptionProgress,
        });
      }

      await migrateAssetsForAppEncryption({ encryptAtRest });
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
      appEncryptionBusy.value = false;
    }
  }

  async function toggleAppEncryption(enabled) {
    if (appEncryptionBusy.value) return;
    appEncryptionError.value = '';
    const shouldEnable =
      typeof enabled === 'boolean' ? enabled : appEncryptionEnabled.value;
    appEncryptionEnabled.value = shouldEnable;

    if (shouldEnable) {
      try {
        const alreadySetUp = await appFolderHasEncryption();
        if (!alreadySetUp) {
          refreshAppKeyLoaded();
          return;
        }
        refreshAppKeyLoaded();
      } catch (error) {
        appEncryptionEnabled.value = isAppEncryptionEnabled();
        refreshAppKeyLoaded();
        appEncryptionError.value = error?.message || String(error);
      }
      return;
    }

    try {
      if (!appKeyLoaded.value) {
        appEncryptionEnabled.value = true;
        appEncryptionError.value =
          'Unlock app encryption before disabling so notes can be saved in plain form.';
        return;
      }
      await runAppEncryptionMigration({ encryptAtRest: false });
      await disableAppEncryption();
      refreshAppKeyLoaded();
      appEncryptionEnabled.value = false;
      appConfirmInput.value = '';
    } catch (error) {
      appEncryptionEnabled.value = true;
      refreshAppKeyLoaded();
      appEncryptionError.value = error?.message || String(error);
    }
  }

  async function confirmAppEncryption() {
    if (appEncryptionBusy.value || appUnlockBusy.value) return;
    appEncryptionError.value = '';
    const pass = appConfirmInput.value;
    if (!pass) return;

    try {
      appUnlockBusy.value = true;
      const result = await setupAppEncryption(pass);

      if (!result.ok) {
        appEncryptionError.value = result.error;
        return;
      }

      await runAppEncryptionMigration({ encryptAtRest: true });
      refreshAppKeyLoaded();
      appConfirmInput.value = '';
      appEncryptionEnabled.value = true;
    } catch (error) {
      refreshAppKeyLoaded();
      appEncryptionError.value = String(error);
    } finally {
      appUnlockBusy.value = false;
    }
  }

  async function toggleSyncEncryption() {
    syncCryptoError.value = '';
    if (syncEncryptionEnabled.value) {
      syncKeyLoaded.value = isSyncKeyLoaded();
      return;
    }

    await disableSyncEncryption(false);
    syncKeyLoaded.value = false;
    syncCryptoError.value = '';
  }

  async function verifySyncKey() {
    if (syncUnlockBusy.value) return;
    syncCryptoError.value = '';
    syncUnlockBusy.value = true;
    const result = await setupSyncEncryption(syncPassphraseInput.value);

    if (result.ok) {
      syncKeyLoaded.value = true;
      syncPassphraseInput.value = '';
    } else {
      syncCryptoError.value = result.error;
    }
    syncUnlockBusy.value = false;
  }

  onMounted(() => {
    void hydrateSyncEncryptionState();
  });

  return {
    syncEncryptionEnabled,
    syncKeyLoaded,
    syncPassphraseInput,
    syncCryptoError,
    syncUnlockBusy,
    appEncryptionEnabled,
    appKeyLoaded,
    appEncryptionBusy,
    appUnlockBusy,
    appEncryptionProgress,
    appEncryptionProgressPercent,
    appEncryptionProgressLabel,
    appEncryptionError,
    appConfirmInput,
    passwordInput,
    securityError,
    hasPassword,
    resetPasswordDialog,
    setGlobalPassword,
    changePasswordDialog,
    toggleAppEncryption,
    confirmAppEncryption,
    toggleSyncEncryption,
    verifySyncKey,
    hydrateSyncEncryptionState,
    setupEncryption: setGlobalPassword,
  };
}
