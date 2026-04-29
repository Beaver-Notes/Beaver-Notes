<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="mb-14 w-full max-w-xl space-y-6">
    <ui-card class="general space-y-8 mb-14 w-full max-w-xl">
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
              <span
                class="flex-1 text-sm text-neutral-600 dark:text-neutral-300"
              >
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
                aria-label="Global password"
                :aria-describedby="securityError ? 'security-error' : undefined"
                :placeholder="
                  translations.settings.choosePassword || 'Choose a password...'
                "
                @keyup.enter="setGlobalPassword"
              />
              <ui-button :disabled="!passwordInput" @click="setGlobalPassword">
                {{ translations.settings.setPassword || 'Set password' }}
              </ui-button>
            </div>
            <p
              v-if="securityError"
              id="security-error"
              role="alert"
              class="text-sm text-red-500 mt-1"
            >
              {{ securityError }}
            </p>
          </template>
        </div>

        <div class="py-3">
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
          <p
            v-if="appEncryptionError"
            id="app-encryption-error"
            role="alert"
            class="text-xs text-red-500 mt-2"
          >
            {{ appEncryptionError }}
          </p>
          <transition name="setting-fade">
            <div
              v-if="appEncryptionBusy"
              class="mt-2 rounded-md dark:bg-primary/10"
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
                :disabled="appEncryptionBusy || appUnlockBusy"
                aria-label="App encryption password"
                :aria-describedby="
                  appEncryptionError ? 'app-encryption-error' : undefined
                "
                :placeholder="translations.settings.password || 'Password...'"
                @keyup.enter="confirmAppEncryption"
              />
              <ui-button
                :disabled="
                  !appConfirmInput || appEncryptionBusy || appUnlockBusy
                "
                @click="confirmAppEncryption"
              >
                {{ translations.settings.unlock || 'Unlock' }}
              </ui-button>
            </div>
          </transition>
        </div>

        <div class="py-3">
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
                :disabled="syncUnlockBusy"
                aria-label="Sync encryption password"
                :aria-describedby="
                  syncCryptoError ? 'sync-crypto-error' : undefined
                "
                :placeholder="translations.settings.password || 'Password...'"
                @keyup.enter="verifySyncKey"
              />
              <ui-button
                :disabled="!syncPassphraseInput || syncUnlockBusy"
                @click="verifySyncKey"
              >
                {{ translations.settings.unlock || 'Unlock' }}
              </ui-button>
            </div>
          </transition>
          <p
            v-if="syncCryptoError"
            id="sync-crypto-error"
            role="alert"
            class="text-xs text-red-500 mt-2"
          >
            {{ syncCryptoError }}
          </p>
        </div>
      </section>
    </ui-card>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useDialog } from '@/composable/dialog';
import { useTranslations } from '@/composable/useTranslations';
import { usePasswordStore } from '@/store/passwd';
import { useNoteStore } from '@/store/note';
import {
  isSyncEncryptionEnabled,
  isSyncKeyLoaded,
  setupSyncEncryption,
  disableSyncEncryption,
  syncFolderHasEncryption,
} from '@/utils/sync/crypto.js';
import {
  isAppEncryptionEnabled,
  isAppKeyLoaded,
  setupAppEncryption,
  disableAppEncryption,
  appFolderHasEncryption,
} from '@/utils/appCrypto.js';
import { getSyncPath } from '@/utils/sync/path.js';
import { migrateAssetEncryption } from '@/lib/native/security';
import { unlockEnabledEncryptionScopes } from '@/utils/encryptionCoordinator.js';

const { translations } = useTranslations();
const dialog = useDialog();
const passwordStore = usePasswordStore();
const noteStore = useNoteStore();
const passwordInput = ref('');
const securityError = ref('');
const hasPassword = ref(!!passwordStore.sharedKey);

const syncPath = ref('');
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
const APP_ENCRYPTION_YIELD_EVERY = 5;

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
            await passwordStore.resetPassword(currentPassword, newPassword);
            await unlockEnabledEncryptionScopes(newPassword);
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
    await unlockEnabledEncryptionScopes(passwordInput.value);
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

function yieldToUi() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function migrateAssetsForAppEncryption({ encryptAtRest }) {
  const phase = encryptAtRest ? 'assets-encrypt' : 'assets-plaintext';
  updateAppEncryptionProgress({
    phase,
    processed: 0,
    total: 0,
  });

  const result = await migrateAssetEncryption(encryptAtRest);
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
      refreshAppKeyLoaded();
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
  if (appEncryptionBusy.value || appUnlockBusy.value) return;
  appEncryptionError.value = '';
  const pass = appConfirmInput.value;
  if (!pass) return;

  try {
    appUnlockBusy.value = true;
    const result = await setupAppEncryption(pass);

    if (!result.ok) {
      appEncryptionError.value = result.error;
    } else {
      await runAppEncryptionMigration({ encryptAtRest: true });
      refreshAppKeyLoaded();
      appConfirmInput.value = '';
      appEncryptionEnabled.value = true;
    }
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
  } else {
    await disableSyncEncryption(false);
    syncKeyLoaded.value = false;
    syncCryptoError.value = '';
  }
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

async function hydrateSyncEncryptionState() {
  const folderEncrypted = await syncFolderHasEncryption();
  if (folderEncrypted) {
    syncEncryptionEnabled.value = true;
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
  transition: opacity 180ms ease, transform 180ms ease;
}

.setting-fade-enter-from,
.setting-fade-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
