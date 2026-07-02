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
            'One passphrase protects your notes on this device and sync commits when sync is enabled.'
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
                :aria-label="
                  translations.settings.globalPassword || 'Global password'
                "
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
                {{ translations.settings.encryption || 'Encryption' }}
              </span>
              <p class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                {{
                  translations.settings.encryptionDesc ||
                  'Encrypts note content on this device and sync commits when sync is enabled.'
                }}
              </p>
            </div>
            <ui-switch
              v-model="encryptionEnabled"
              :disabled="encryptionBusy"
              @change="toggleEncryption"
            />
          </div>
          <p
            v-if="encryptionError"
            id="encryption-error"
            role="alert"
            class="text-xs text-red-500 mt-2"
          >
            {{ encryptionError }}
          </p>
          <transition name="setting-fade">
            <div
              v-if="encryptionBusy"
              class="mt-2 rounded-lg dark:bg-primary/10"
            >
              <p class="text-xs text-primary">
                {{ encryptionProgressLabel }}:
                {{ encryptionProgress.processed }} /
                {{ encryptionProgress.total }}
                ({{ encryptionProgressPercent }}%)
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
                  :style="{ width: `${encryptionProgressPercent}%` }"
                />
              </div>
            </div>
          </transition>

          <transition name="setting-fade">
            <div
              v-if="encryptionEnabled && !keyLoaded"
              class="flex items-center gap-2 mt-2"
            >
              <ui-input
                v-model="passphraseInput"
                type="password"
                class="flex-1"
                :disabled="encryptionBusy || unlockBusy"
                :aria-label="
                  translations.settings.encryptionPassphrase ||
                  'Encryption passphrase'
                "
                :aria-describedby="
                  encryptionError ? 'encryption-error' : undefined
                "
                :placeholder="translations.settings.password || 'Password...'"
                @keyup.enter="confirmEncryption"
              />
              <ui-button
                :disabled="!passphraseInput || encryptionBusy || unlockBusy"
                @click="confirmEncryption"
              >
                {{ translations.settings.unlock || 'Unlock' }}
              </ui-button>
            </div>
          </transition>
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
  isEncryptionEnabled,
  isKeyLoaded,
  setupEncryption,
  disableEncryption,
  encryptionIsConfigured,
  verifyPassphrase,
} from '@/utils/crypto/encryption.js';
import {
  migrateAssetEncryption,
  onAssetMigrationProgress,
} from '@/lib/native/security';

const { translations } = useTranslations();
const dialog = useDialog();
const passwordStore = usePasswordStore();
const noteStore = useNoteStore();

const passwordInput = ref('');
const securityError = ref('');
const hasPassword = ref(!!passwordStore.sharedKey);

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
    body: translations.value.settings.body || 'This data is encrypted, you need to input the password to get access',
    icon: 'riLockLine',
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
  resetPasswordDialog();
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

  try {
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
  } else {
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
    } else {
      result = await setupEncryption(pass);
      if (!result.ok) {
        encryptionError.value = result.error;
        return;
      }
    }

    await runEncryptionMigration({ encryptAtRest: true });
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

onMounted(async () => {
  await passwordStore.retrieve();
  hasPassword.value = !!passwordStore.sharedKey;
  refreshKeyLoaded();
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
