import { computed, onMounted, ref } from 'vue';
import { readData, readDir, writeFile } from '@/lib/native/fs';
import { path } from '@/lib/tauri-bridge';
import {
  isSyncEncryptionEnabled,
  isSyncKeyLoaded,
  syncFolderHasEncryption,
  tryRestoreKeyFromSafeStorage,
  verifySyncPassphrase,
  setupSyncEncryption,
  disableSyncEncryption,
} from '@/utils/sync/crypto.js';
import {
  isAppEncryptionEnabled,
  isAppKeyLoaded,
  setupAppEncryption,
  verifyAppPassphrase,
  disableAppEncryption,
  appFolderHasEncryption,
} from '@/utils/appCrypto.js';

export function useSettingsSecurity({
  dialog,
  noteStore,
  passwordStore,
  translations,
  getEffectiveDataDir,
  showDialogAlert,
}) {
  const syncEncryptionEnabled = ref(isSyncEncryptionEnabled());
  const syncKeyLoaded = ref(isSyncKeyLoaded());
  const syncPassphraseInput = ref('');
  const syncCryptoError = ref('');
  const appEncryptionEnabled = ref(isAppEncryptionEnabled());
  const appKeyLoaded = ref(isAppKeyLoaded());
  const appEncryptionBusy = ref(false);
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
      await tryRestoreKeyFromSafeStorage();
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
              await passwordStore.setsharedKey(newPassword);
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

  function base64ToUint8Array(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function isIgnoredAssetEntry(name) {
    return !name || name.startsWith('.') || name === 'Thumbs.db';
  }

  async function listAssetFiles(dataDir) {
    const roots = ['notes-assets', 'file-assets'];
    const files = [];

    for (const root of roots) {
      const rootDir = path.join(dataDir, root);
      const noteDirs = await readDir(rootDir).catch(() => []);
      for (const noteDir of noteDirs) {
        if (isIgnoredAssetEntry(noteDir)) continue;
        const fullNoteDir = path.join(rootDir, noteDir);
        const assetNames = await readDir(fullNoteDir).catch(() => []);
        for (const assetName of assetNames) {
          if (isIgnoredAssetEntry(assetName)) continue;
          files.push(path.join(fullNoteDir, assetName));
        }
      }
    }

    return files;
  }

  async function migrateAssetsForAppEncryption({ encryptAtRest }) {
    const dataDir = await getEffectiveDataDir();
    if (!dataDir) return;

    const files = await listAssetFiles(dataDir);
    const phase = encryptAtRest ? 'assets-encrypt' : 'assets-plaintext';
    const failures = [];
    let processed = 0;

    for (const filePath of files) {
      try {
        const base64 = await readData(filePath);
        if (base64) {
          await writeFile(filePath, base64ToUint8Array(base64), {
            skipAssetEncryption: !encryptAtRest,
          });
        }
      } catch {
        failures.push(filePath);
      } finally {
        processed += 1;
        updateAppEncryptionProgress({
          phase,
          processed,
          total: files.length,
          id: filePath,
        });
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `Failed to migrate ${failures.length} asset file(s) during app-encryption update.`
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

    try {
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

        const restored = await verifyAppPassphrase();
        refreshAppKeyLoaded();
        if (restored.ok) {
          await runAppEncryptionMigration({ encryptAtRest: true });
        }
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
      await disableAppEncryption(async () => {
        await noteStore.persistAllNotesPlaintext();
      });
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
    if (appEncryptionBusy.value) return;
    appEncryptionError.value = '';
    const pass = appConfirmInput.value;
    if (!pass) return;

    try {
      const alreadySetUp = await appFolderHasEncryption();
      const result = alreadySetUp
        ? await verifyAppPassphrase(pass)
        : await setupAppEncryption(pass);

      if (!result.ok) {
        appEncryptionError.value = result.error;
        return;
      }

      refreshAppKeyLoaded();
      appConfirmInput.value = '';
      await runAppEncryptionMigration({ encryptAtRest: true });
    } catch (error) {
      refreshAppKeyLoaded();
      appEncryptionError.value = String(error);
    }
  }

  async function toggleSyncEncryption() {
    syncCryptoError.value = '';
    if (syncEncryptionEnabled.value) {
      localStorage.setItem('syncEncryptionEnabled', 'true');
      try {
        const restored = await tryRestoreKeyFromSafeStorage();
        if (restored) {
          syncKeyLoaded.value = true;
        }
      } catch (error) {
        syncEncryptionEnabled.value = false;
        localStorage.removeItem('syncEncryptionEnabled');
        syncCryptoError.value = String(error);
      }
      return;
    }

    await disableSyncEncryption(false);
    syncKeyLoaded.value = false;
    syncCryptoError.value = '';
  }

  async function verifySyncKey() {
    syncCryptoError.value = '';
    const alreadySetUp = await syncFolderHasEncryption();
    const result = alreadySetUp
      ? await verifySyncPassphrase(syncPassphraseInput.value)
      : await setupSyncEncryption(syncPassphraseInput.value);

    if (result.ok) {
      syncKeyLoaded.value = true;
      syncPassphraseInput.value = '';
    } else {
      syncCryptoError.value = result.error;
    }
  }

  onMounted(() => {
    void hydrateSyncEncryptionState();
  });

  return {
    syncEncryptionEnabled,
    syncKeyLoaded,
    syncPassphraseInput,
    syncCryptoError,
    appEncryptionEnabled,
    appKeyLoaded,
    appEncryptionBusy,
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
