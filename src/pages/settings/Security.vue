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

        <div class="py-3">
          <div class="flex items-start justify-between gap-4">
            <div class="flex-1 min-w-0">
              <span class="block text-base">
                {{ translations.settings.encryption || 'Encryption' }}
              </span>
              <p class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                {{
                  translations.settings.encryptionDesc ||
                  'All notes and assets are encrypted at rest. Encryption is a core part of storage.'
                }}
              </p>
            </div>
            <span
              class="inline-flex items-center gap-1 text-xs text-primary font-medium"
            >
              <v-remixicon name="riShieldCheckLine" size="16" />
              {{ translations.settings.encryptionAlwaysOn || 'Always on' }}
            </span>
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
                  :style="{ transform: `scaleX(${encryptionProgressPercent / 100})` }"
                />
              </div>
            </div>
          </transition>

          <div class="flex items-center gap-2 mt-3">
            <ui-button
              class="text-sm"
              :disabled="encryptionBusy"
              @click="changeEncryptionPassphrase"
            >
              {{
                translations.settings.changePassphrase || 'Change Passphrase'
              }}
            </ui-button>
            <ui-button
              class="text-sm"
              variant="secondary"
              :disabled="encryptionBusy || !keyLoaded"
              @click="rotateKey"
            >
              {{ translations.settings.rotateKey || 'Rotate key' }}
            </ui-button>
            <details class="ml-2">
              <summary class="text-sm cursor-pointer text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300">
                {{ translations.settings.advanced || 'Advanced' }}
              </summary>
              <div class="mt-2 flex flex-col gap-2">
                <ui-button
                  class="text-sm"
                  variant="secondary"
                  :disabled="encryptionBusy || !keyLoaded"
                  @click="lockNow"
                >
                  {{ translations.settings.lockNow || 'Lock Now' }}
                </ui-button>
                <ui-button
                  class="text-sm"
                  variant="secondary"
                  :disabled="encryptionBusy || !keyLoaded"
                  @click="showRecoveryCode"
                >
                  {{ translations.settings.showRecoveryCode || 'Recovery code' }}
                </ui-button>
              </div>
            </details>
          </div>
        </div>
      </section>
    </ui-card>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useDialog } from '@/lib/dialog';
import { useTranslations } from '@/composable/useTranslations';
import { useNoteStore } from '@/store/note';
import {
  isKeyLoaded,
  setupEncryption,
  verifyPassphrase,
  lockEncryptionKey,
  generateRecoveryCode,
} from '@/utils/crypto/encryption.js';
import {
  migrateAssetEncryption,
  onAssetMigrationProgress,
  rotateEncryptionKey,
  reconcileSyncKeyParams,
} from '@/lib/native/security';
import { publishCloudKeyParams } from '@/utils/sync/vault-key-params.js';

const { translations } = useTranslations();
const dialog = useDialog();
const noteStore = useNoteStore();

const keyLoaded = ref(isKeyLoaded());
const encryptionBusy = ref(false);
const encryptionProgress = ref({
  phase: '',
  processed: 0,
  total: 0,
});
const encryptionError = ref('');

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
      return (
        translations.settings?.decryptingExistingNotes ||
        'Decrypting existing notes'
      );
    case 'encrypt':
      return translations.settings?.encryptingNotes || 'Encrypting notes';
    case 'assets-encrypt':
      return translations.settings?.encryptingAssets || 'Encrypting assets';
    default:
      return translations.settings?.processingNotes || 'Processing notes';
  }
});

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

async function migrateAssetsForEncryption() {
  const phase = 'assets-encrypt';
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
    const result = await migrateAssetEncryption();
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

async function runEncryptionMigration() {
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

    await noteStore.persistAllNotesForAppEncryption({
      onProgress: updateEncryptionProgress,
    });

    await migrateAssetsForEncryption();
  } finally {
    encryptionBusy.value = false;
  }
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
    password: true,
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
          password: true,
          onConfirm: async (newPass) => {
            if (!newPass) return;
            if (newPass.length < 8) {
              encryptionError.value =
                translations.value.settings.passwordTooShort ||
                'Passphrase must be at least 8 characters.';
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
              password: true,
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

async function rotateKey() {
  if (encryptionBusy.value) return;
  encryptionBusy.value = true;
  try {
    await rotateEncryptionKey();
    reconcileSyncKeyParams().catch(() => {});
    publishCloudKeyParams().catch(() => {});
    dialog.alert({
      title: translations.value.settings.keyRotated || 'Key Rotated',
      body: translations.value.settings.keyRotatedDesc ||
        'The encryption key has been rotated. Old keys remain available for existing notes.',
      okText: translations.value.dialog?.close || 'Close',
    });
  } catch (e) {
    encryptionError.value = String(e);
  } finally {
    encryptionBusy.value = false;
  }
}

async function showRecoveryCode() {
  const t = translations.value;
  dialog.prompt({
    title: t.settings.confirmPassphrase || 'Confirm Passphrase',
    body: t.settings.recoveryCodeConfirm ||
      'Enter your passphrase to reveal the recovery code.',
    icon: 'riLockLine',
    okText: t.settings.next || 'Next',
    cancelText: t.settings.cancel || 'Cancel',
    password: true,
    onConfirm: async (passphrase) => {
      if (!passphrase) return;
      const result = await verifyPassphrase(passphrase);
      if (!result.ok) {
        dialog.alert({
          title: t.settings.alertTitle || 'Alert',
          body: result.error || 'Incorrect passphrase.',
          okText: t.dialog?.close || 'Close',
        });
        return;
      }
      try {
        const code = await generateRecoveryCode();
        if (!code) {
          dialog.alert({
            title: t.settings.alertTitle || 'Alert',
            body: t.settings.recoveryCodeError || 'Failed to generate recovery code.',
            okText: t.dialog?.close || 'Close',
          });
          return;
        }
        dialog.alert({
          title: t.settings.recoveryCode || 'Recovery Code',
          body: t.settings.recoveryCodeBody ||
            'Store this code somewhere safe. It can unlock the app if you forget your passphrase.\n\n' + code,
          okText: t.dialog?.close || 'Close',
        });
      } catch (e) {
        dialog.alert({
          title: t.settings.alertTitle || 'Alert',
          body: String(e),
          okText: t.dialog?.close || 'Close',
        });
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
</script>

<style scoped>
.app-encryption-progress-bar {
  width: 100%;
  transform-origin: left;
  transition: transform 200ms var(--ease-standard);
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
