<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="general space-y-8 mb-14 w-full max-w-xl">
    <section>
      <p class="mb-1 font-medium">
        {{ translations.settings.security || 'Security' }}
      </p>
      <p class="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
        {{
          translations.settings.securityDesc ||
          'One password powers note locking, app-wide encryption, and sync encryption independently.'
        }}
      </p>

      <div class="mb-4">
        <template v-if="hasPassword">
          <div class="flex items-center gap-2">
            <span class="flex-1 text-sm text-neutral-600 dark:text-neutral-300">
              <v-remixicon
                name="riShieldCheckLine"
                class="inline mr-1 text-primary"
                size="16"
              />
              {{
                translations.settings.passwordSet || 'Global password is set'
              }}
            </span>
            <ui-button class="text-sm" @click="changePasswordDialog">
              {{ translations.settings.changePassword || 'Change' }}
            </ui-button>
          </div>
        </template>
        <template v-else>
          <div class="flex items-center gap-2">
            <ui-input
              v-model="passwordInput"
              type="password"
              class="flex-1"
              :placeholder="
                translations.settings.choosePassword || 'Choose a password...'
              "
              @keyup.enter="setGlobalPassword"
            />
            <ui-button :disabled="!passwordInput" @click="setGlobalPassword">
              {{ translations.settings.setPassword || 'Set password' }}
            </ui-button>
          </div>
          <p v-if="securityError" class="text-sm text-red-500 mt-1">
            {{ securityError }}
          </p>
        </template>
      </div>

      <div class="py-3 border-t border-neutral-200 dark:border-neutral-700">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1 min-w-0">
            <span class="block text-base">
              {{
                translations.settings.appEncryption || 'Encrypt notes on disk'
              }}
            </span>
            <p class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
              {{
                translations.settings.appEncryptionDesc ||
                'All notes are encrypted at rest. Requires your password on each startup.'
              }}
            </p>
          </div>
          <ui-switch
            v-model="appEncryptionEnabled"
            :disabled="appEncryptionBusy"
            @change="toggleAppEncryption"
          />
        </div>
        <p v-if="appEncryptionError" class="text-xs text-red-500 mt-2">
          {{ appEncryptionError }}
        </p>
        <transition name="setting-fade">
          <div
            v-if="appEncryptionBusy"
            class="mt-2 rounded-md border border-primary/60 bg-primary/80 p-2 dark:border-primary/40 dark:bg-primary/10"
          >
            <p class="text-xs text-primary">
              {{ appEncryptionProgressLabel }}:
              {{ appEncryptionProgress.processed }} /
              {{ appEncryptionProgress.total }}
              ({{ appEncryptionProgressPercent }}%)
            </p>
            <p class="text-xs text-primary dark:text-primary/80 mt-1">
              {{
                translations.settings.keepSettingsOpen ||
                'Keep this page open until migration completes.'
              }}
            </p>
            <div class="mt-2 h-1.5 rounded bg-primary/70 dark:bg-primary/20">
              <div
                class="app-encryption-progress-bar h-1.5 rounded bg-primary dark:bg-primary/80"
                :style="{ width: `${appEncryptionProgressPercent}%` }"
              />
            </div>
          </div>
        </transition>

        <transition name="setting-fade">
          <div
            v-if="appEncryptionEnabled && !appKeyLoaded"
            class="flex items-center gap-2 mt-2"
          >
            <ui-input
              v-model="appConfirmInput"
              type="password"
              class="flex-1"
              :disabled="appEncryptionBusy"
              :placeholder="translations.settings.password || 'Password...'"
              @keyup.enter="confirmAppEncryption"
            />
            <ui-button
              :disabled="!appConfirmInput || appEncryptionBusy"
              @click="confirmAppEncryption"
            >
              {{ translations.settings.unlock || 'Unlock' }}
            </ui-button>
          </div>
        </transition>
      </div>

      <div class="py-3 border-t border-neutral-200 dark:border-neutral-700">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1 min-w-0">
            <span class="block text-base">
              {{
                translations.settings.syncEncryption || 'Encrypt sync folder'
              }}
            </span>
            <p class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
              {{
                translations.settings.syncEncryptionDesc ||
                'Commits and assets in your sync folder are encrypted. Same password, independent key.'
              }}
            </p>
          </div>
          <ui-switch
            v-model="syncEncryptionEnabled"
            :disabled="!hasSyncFolder"
            @change="toggleSyncEncryption"
          />
        </div>
        <p
          v-if="!hasSyncFolder"
          class="text-xs text-amber-600 dark:text-amber-400 mt-2"
        >
          {{
            translations.settings.syncPathRequired ||
            'Set a sync folder in General to enable sync encryption.'
          }}
        </p>
        <transition name="setting-fade">
          <div
            v-if="hasSyncFolder && syncEncryptionEnabled && !syncKeyLoaded"
            class="flex items-center gap-2 mt-2"
          >
            <ui-input
              v-model="syncPassphraseInput"
              type="password"
              class="flex-1"
              :placeholder="translations.settings.password || 'Password...'"
              @keyup.enter="verifySyncKey"
            />
            <ui-button :disabled="!syncPassphraseInput" @click="verifySyncKey">
              {{ translations.settings.unlock || 'Unlock' }}
            </ui-button>
          </div>
        </transition>
        <p v-if="syncCryptoError" class="text-xs text-red-500 mt-2">
          {{ syncCryptoError }}
        </p>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useDialog } from '@/composable/dialog';
import { useStorage } from '@/composable/storage';
import { useTranslations } from '@/composable/useTranslations';
import { usePasswordStore } from '@/store/passwd';
import { useNoteStore } from '@/store/note';
import {
  isSyncEncryptionEnabled,
  isSyncKeyLoaded,
  verifySyncPassphrase,
  setupSyncEncryption,
  disableSyncEncryption,
  syncFolderHasEncryption,
  tryRestoreKeyFromSafeStorage,
} from '@/utils/syncCrypto.js';
import {
  isAppEncryptionEnabled,
  isAppKeyLoaded,
  setupAppEncryption,
  verifyAppPassphrase,
  disableAppEncryption,
  appFolderHasEncryption,
} from '@/utils/appCrypto.js';
import { getSyncPath } from '@/utils/syncPath.js';

const { translations } = useTranslations();
const dialog = useDialog();
const storage = useStorage();
const passwordStore = usePasswordStore();
const noteStore = useNoteStore();
const { ipcRenderer, path } = window.electron;

const passwordInput = ref('');
const securityError = ref('');
const hasPassword = ref(!!passwordStore.sharedKey);

const syncPath = ref('');
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

const hasSyncFolder = computed(() => Boolean(syncPath.value?.trim()));

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

function showDialogAlert(message) {
  dialog.alert({
    title: translations.value.settings.alertTitle || 'Alert',
    body: message,
    okText: translations.value.dialog?.close || 'Close',
  });
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
            hasPassword.value = true;
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
  resetPasswordDialog();
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
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
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
    const noteDirs = await ipcRenderer
      .callMain('fs:readdir', rootDir)
      .catch(() => []);

    for (const noteDir of noteDirs) {
      if (isIgnoredAssetEntry(noteDir)) continue;
      const fullNoteDir = path.join(rootDir, noteDir);
      const assetNames = await ipcRenderer
        .callMain('fs:readdir', fullNoteDir)
        .catch(() => []);

      for (const assetName of assetNames) {
        if (isIgnoredAssetEntry(assetName)) continue;
        files.push(path.join(fullNoteDir, assetName));
      }
    }
  }

  return files;
}

async function migrateAssetsForAppEncryption({ encryptAtRest }) {
  const dataDir = await storage.get('dataDir', '', 'settings');
  if (!dataDir) return;

  const files = await listAssetFiles(dataDir);
  const phase = encryptAtRest ? 'assets-encrypt' : 'assets-plaintext';
  const total = files.length;
  let processed = 0;
  const failures = [];

  for (const filePath of files) {
    try {
      const base64 = await ipcRenderer.callMain('fs:readData', filePath);
      if (base64) {
        await ipcRenderer.callMain('fs:writeFile', {
          path: filePath,
          data: base64ToUint8Array(base64),
          skipAssetEncryption: !encryptAtRest,
        });
      }
    } catch (error) {
      failures.push(filePath);
    } finally {
      processed += 1;
      updateAppEncryptionProgress({
        phase,
        processed,
        total,
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
  } else {
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
    } else {
      refreshAppKeyLoaded();
      appConfirmInput.value = '';
      await runAppEncryptionMigration({ encryptAtRest: true });
    }
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
  } else {
    await disableSyncEncryption(false);
    syncKeyLoaded.value = false;
    syncCryptoError.value = '';
  }
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

onMounted(async () => {
  await passwordStore.retrieve();
  hasPassword.value = !!passwordStore.sharedKey;
  syncPath.value = await getSyncPath();
  await hydrateSyncEncryptionState();
});
</script>

<style scoped>
.app-encryption-progress-bar {
  transition: width 200ms ease;
}

.setting-fade-enter-active,
.setting-fade-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}

.setting-fade-enter-from,
.setting-fade-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
