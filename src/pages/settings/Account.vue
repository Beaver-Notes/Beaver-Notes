<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="mb-14 w-full max-w-xl space-y-6">
    <section v-if="accountStore.isAnonymous" class="space-y-2">
      <p class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
        {{ translations.account?.title || 'Beaver Account' }}
      </p>
      <div
        class="space-y-1 bg-neutral-50 dark:bg-neutral-800 rounded-xl border"
      >
        <div class="flex flex-col gap-3 px-4 py-4">
          <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">
            {{
              translations.account?.signInHeading ||
              'Sign in to sync across devices.'
            }}
          </p>
          <p
            class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
          >
            {{
              translations.account?.signInBody ||
              'A Beaver Account is optional. Without one, your notes stay on this device only.'
            }}
          </p>
        </div>

        <div class="flex flex-col gap-2 px-4 pb-3">
          <ui-input
            v-model="passkeyEmail"
            type="email"
            class="w-full"
            :placeholder="
              translations.account?.emailPlaceholder || 'Email (optional)'
            "
            :aria-label="
              translations.account?.emailPlaceholder || 'Email (optional)'
            "
          />
          <div class="flex gap-2">
            <ui-button
              class="flex-1"
              :loading="accountStore.busy"
              :disabled="accountStore.busy"
              @click="handleSignInWithPasskey"
            >
              <v-remixicon name="riFingerprintLine" class="mr-1" />
              {{ translations.account?.signIn || 'Sign in' }}
            </ui-button>
            <ui-button
              class="flex-1"
              variant="primary"
              :loading="accountStore.busy"
              :disabled="accountStore.busy"
              @click="handleSignUpWithPasskey"
            >
              {{ translations.account?.createAccount || 'Create account' }}
            </ui-button>
          </div>
        </div>

        <div
          class="border-t border-neutral-200 dark:border-neutral-700 px-4 py-3"
        >
          <button
            class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors cursor-pointer"
            @click="showPasswordAuth = !showPasswordAuth"
          >
            {{ showPasswordAuth ? '↑' : '↓' }}
            {{ translations.account?.withPassword || 'Or sign in with password' }}
          </button>
          <div v-if="showPasswordAuth" class="mt-2 flex flex-col gap-2">
            <ui-input
              v-model="signInEmail"
              type="email"
              class="w-full"
              :placeholder="translations.account?.emailPlaceholder || 'Email'"
            />
            <ui-input
              v-model="signInPassword"
              type="password"
              class="w-full"
              :placeholder="
                translations.account?.passwordPlaceholder || 'Password'
              "
              @keyup.enter="handleSignInWithPassword"
            />
            <div class="flex gap-2">
              <ui-button
                class="flex-1"
                :loading="accountStore.busy"
                :disabled="accountStore.busy"
                @click="handleSignInWithPassword"
              >
                {{ translations.account?.signInWithPassword || 'Sign in' }}
              </ui-button>
              <ui-button
                class="flex-1"
                variant="primary"
                :loading="accountStore.busy"
                :disabled="accountStore.busy"
                @click="handleSignUpWithPassword"
              >
                {{ translations.account?.createAccount || 'Create account' }}
              </ui-button>
            </div>
          </div>
        </div>

        <div
          class="border-t border-neutral-200 dark:border-neutral-700 px-4 py-3"
        >
          <button
            class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors cursor-pointer"
            @click="showQuickConnect = !showQuickConnect"
          >
            {{ showQuickConnect ? '↑' : '↓' }}
            {{ translations.account?.quickConnect || 'Signing in from another device?' }}
          </button>
          <div v-if="showQuickConnect" class="mt-2 space-y-2">
            <p class="text-xs text-neutral-500 dark:text-neutral-400">
              {{
                translations.account?.quickConnectBody ||
                'Approve a code on another device that is already signed in.'
              }}
            </p>
            <div v-if="!quickConnectSecret">
              <ui-button
                class="w-full"
                variant="secondary"
                :loading="accountStore.busy"
                :disabled="accountStore.busy"
                @click="startQuickConnect"
              >
                <v-remixicon name="riQrCodeLine" class="mr-1" />
                {{
                  translations.account?.quickConnectStart || 'Start'
                }}
              </ui-button>
            </div>
            <div v-else class="space-y-2">
              <div
                class="rounded-lg bg-neutral-100 px-3 py-2 font-mono text-lg text-center tracking-widest dark:bg-neutral-900 dark:text-neutral-200"
              >
                {{
                  translations.account?.quickConnectHint ||
                  'Enter this code on your other device, or paste a code from another device here.'
                }}
              </div>
              <ui-input
                v-model="quickConnectCode"
                class="w-full"
                :placeholder="
                  translations.account?.quickConnectEnterCode ||
                  'Enter code from another device'
                "
                @keyup.enter="authorizeQuickConnect"
              />
              <div class="flex gap-2">
                <ui-button
                  class="flex-1"
                  variant="secondary"
                  @click="pollQuickConnect"
                >
                  <v-remixicon name="riRefreshLine" class="mr-1" />
                  {{
                    translations.account?.quickConnectCheck || 'Check approval'
                  }}
                </ui-button>
                <ui-button
                  class="flex-1"
                  :loading="accountStore.busy"
                  :disabled="accountStore.busy"
                  @click="authorizeQuickConnect"
                >
                  {{ translations.account?.quickConnectUse || 'Use code' }}
                </ui-button>
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="accountStore.error"
          class="border-t border-neutral-200 dark:border-neutral-700 px-4 py-3"
        >
          <p class="text-sm text-red-500" role="alert">
            {{ accountStore.error }}
          </p>
        </div>
      </div>
    </section>

    <section v-else class="space-y-2">
      <p class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
        {{ translations.account?.title || 'Beaver Account' }}
      </p>
      <div
        class="space-y-1 bg-neutral-50 dark:bg-neutral-800 rounded-xl border"
      >
        <div class="flex items-center gap-3 px-4 py-3.5">
          <div
            class="shrink-0 w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center"
          >
            <v-remixicon name="riUserLine" size="20" />
          </div>
          <div class="min-w-0 flex-1">
            <p
              class="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate"
            >
              {{
                accountStore.profile?.email ||
                accountStore.profile?.username ||
                translations.account?.signedInAs ||
                'Signed in'
              }}
            </p>
            <p
              class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400 truncate"
            >
              {{ accountStore.serverUrl }}
            </p>
          </div>
          <ui-button variant="danger" @click="handleSignOut">
            <v-remixicon name="riLogoutBoxRLine" class="mr-1" />
            {{ translations.account?.signOut || 'Sign out' }}
          </ui-button>
        </div>

        <!-- Seeding Progress -->
        <div
          v-if="accountStore.seedStatus === 'seeding'"
          class="border-t border-neutral-200 dark:border-neutral-700 px-4 py-3.5"
        >
          <div class="flex items-center gap-3 mb-3">
            <div class="animate-spin">
              <v-remixicon name="riLoader4Line" class="text-primary" size="18" />
            </div>
            <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">
              {{ seedPhaseLabel }}
            </p>
          </div>
          <div class="space-y-2">
            <div class="flex justify-between text-xs text-neutral-600 dark:text-neutral-400">
              <span>{{ seedPhaseLabel }}</span>
              <span>{{ accountStore.seedProgress.uploaded }} / {{ accountStore.seedProgress.total }}</span>
            </div>
            <div class="h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-700 overflow-hidden">
              <div
                class="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                :style="{ width: seedProgressPercent + '%' }"
              ></div>
            </div>
          </div>
        </div>

        <div
          v-else-if="accountStore.seedStatus === 'done'"
          class="border-t border-neutral-200 dark:border-neutral-700 px-4 py-3.5"
        >
          <div class="flex items-center gap-2">
            <v-remixicon name="riCheckLine" class="text-green-600 dark:text-green-400" size="18" />
            <p class="text-sm font-medium text-green-700 dark:text-green-300">
              Cloud sync ready
            </p>
          </div>
        </div>

        <!-- Vault import prompt for existing apps -->
        <div
          v-if="showVaultImportPrompt"
          class="border-t border-neutral-200 dark:border-neutral-700 px-4 py-3.5"
        >
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                {{ translations.account?.vaultDetected || 'Vault detected' }}
              </p>
              <p class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                {{ translations.account?.vaultDetectedBody || 'A vault was found in your sync source. Import it to unlock your notes.' }}
               </p>
            </div>
            <ui-button size="sm" @click="importVaultDialog">
              {{ translations.account?.importVault || 'Import' }}
            </ui-button>
          </div>
        </div>

        <div
          v-else-if="accountStore.seedStatus === 'error'"
          class="border-t border-neutral-200 dark:border-neutral-700 px-4 py-3.5"
        >
          <div class="flex items-center gap-2">
            <v-remixicon name="riErrorWarningLine" class="text-red-600 dark:text-red-400" size="18" />
            <p class="text-sm font-medium text-red-700 dark:text-red-300">
              Sync setup failed
            </p>
          </div>
        </div>

        <div
          class="border-t border-neutral-200 dark:border-neutral-700 flex flex-row items-center gap-3 px-4 py-3.5"
        >
          <div class="min-w-0 flex-1">
            <p
              class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
            >
              {{ translations.account?.plan || 'Plan' }}
            </p>
            <p
              class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400 capitalize"
            >
              {{
                accountStore.plan || translations.account?.noPlan || 'No plan'
              }}
            </p>
          </div>
          <ui-button>
            <v-remixicon name="riExternalLinkLine" class="mr-1" />
            {{ translations.account?.managePlan || 'Manage plan' }}
          </ui-button>
        </div>

        <div
          v-if="accountStore.subscription?.storage && accountStore.plan !== PLAN_NAMES.ENTERPRISE"
          class="border-t border-neutral-200 dark:border-neutral-700 px-4 py-3.5"
        >
          <div class="flex items-center justify-between">
            <p
              class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
            >
              {{ translations.account?.storage || 'Storage' }}
            </p>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">
              {{ (accountStore.subscription.storage.usedBytes / 1073741824).toFixed(1) }} /
              {{ (accountStore.subscription.storage.quotaBytes / 1073741824).toFixed(0) }} GB
            </p>
          </div>
          <div
            class="mt-2 h-1.5 rounded bg-primary/20 dark:bg-primary/20 overflow-hidden"
          >
            <div
              class="h-1.5 rounded bg-primary transition-all duration-200"
              :style="{
                width: `${Math.min(100, accountStore.storageUsedPercent)}%`,
              }"
            />
          </div>
        </div>

        <div
          v-if="!accountStore.isPaidPlan"
          class="border-t border-neutral-200 dark:border-neutral-700 px-4 py-3.5"
        >
          <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">
            {{
              translations.account?.cloudSyncCtaHeading ||
              'Cloud sync is part of Basic.'
            }}
          </p>
          <p
            class="mt-1 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
          >
            {{
              translations.account?.cloudSyncCtaBody ||
              'Upgrade to Basic or higher to sync notes across devices through Beaver Sync. Your current folder sync keeps working in the meantime.'
            }}
          </p>
        </div>
      </div>
    </section>

    <section
      v-if="accountStore.isAuthenticated && accountStore.devices.length"
      class="space-y-2"
    >
      <p class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
        {{ translations.account?.devices || 'Devices' }}
      </p>
      <div
        class="space-y-1 bg-neutral-50 dark:bg-neutral-800 rounded-xl border"
      >
        <div
          v-for="device in accountStore.devices"
          :key="device.deviceId"
          class="flex items-center gap-3 px-4 py-3.5"
        >
          <div
            class="shrink-0 w-9 h-9 rounded-lg bg-neutral-100 dark:bg-neutral-900 flex items-center justify-center"
          >
            <v-remixicon name="riComputerLine" />
          </div>
          <div class="min-w-0 flex-1">
            <p
              class="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate"
            >
              {{ device.label || 'Unknown device' }}
            </p>
            <p
              class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400 truncate font-mono"
            >
              {{ device.deviceId }}
            </p>
          </div>
          <ui-button
            icon
            variant="danger"
            @click="handleRevokeDevice(device.deviceId)"
          >
            <v-remixicon name="riDeleteBin6Line" />
          </ui-button>
        </div>
      </div>
    </section>

    <section v-if="accountStore.isAuthenticated" class="space-y-2">
      <p class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
        {{ translations.account?.security || 'Security' }}
      </p>
      <div
        class="space-y-1 bg-neutral-50 dark:bg-neutral-800 rounded-xl border"
      >
        <div class="flex items-center gap-3 px-4 py-3.5">
          <div class="min-w-0 flex-1">
            <p
              class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
            >
              {{
                translations.account?.signOutEverywhereTitle ||
                'Sign out everywhere'
              }}
            </p>
            <p
              class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
            >
              {{
                translations.account?.signOutEverywhereBody ||
                'Revoke all other devices. This device stays signed in.'
              }}
            </p>
          </div>
          <ui-button variant="danger" @click="handleSignOutEverywhere">
            {{
              translations.account?.signOutEverywhere || 'Sign out everywhere'
            }}
          </ui-button>
        </div>
      </div>
    </section>

    <section class="space-y-2">
      <p class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
        {{ translations.account?.server || 'Server' }}
      </p>
      <div
        class="space-y-1 bg-neutral-50 dark:bg-neutral-800 rounded-xl border"
      >
        <div
          v-if="!showServerUrlEditor"
          class="flex items-center gap-3 px-4 py-3.5"
        >
          <div class="min-w-0 flex-1">
            <p
              class="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate font-mono"
            >
              {{ accountStore.serverUrl }}
            </p>
            <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              {{
                translations.account?.serverHint ||
                'Change this to point at a self-hosted Beaver Sync instance.'
              }}
            </p>
          </div>
          <ui-button @click="showServerUrlEditor = true">
            {{ translations.settings?.changePassword || 'Change' }}
          </ui-button>
        </div>
        <div v-else class="flex flex-col gap-2 px-4 py-3.5">
          <ui-input
            v-model="draftServerUrl"
            class="w-full"
            :placeholder="defaultServerUrl"
          />
          <div class="flex gap-2 justify-end">
            <ui-button variant="secondary" @click="resetServerUrl">{{
              translations.account?.useDefault || 'Use default'
            }}</ui-button>
            <ui-button
              variant="primary"
              :loading="accountStore.busy"
              @click="saveServerUrl"
              >{{ translations.settings?.enable || 'Save' }}</ui-button
            >
            <ui-button @click="showServerUrlEditor = false">{{
              translations.dialog?.cancel || 'Cancel'
            }}</ui-button>
          </div>
        </div>
      </div>
    </section>

    <section v-if="accountStore.isAuthenticated" class="space-y-2">
      <p
        class="text-xs font-semibold uppercase tracking-[0.12em] text-red-500 dark:text-red-400"
      >
        {{ translations.account?.dangerZone || 'Danger zone' }}
      </p>
      <div
        class="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50/80 dark:border-red-900/70 dark:bg-red-950/30 px-4 py-3.5"
      >
        <div class="space-y-0.5">
          <p class="text-sm font-medium text-red-900 dark:text-red-100">
            {{ translations.account?.deleteAccount || 'Delete Beaver Account' }}
          </p>
          <p class="text-xs leading-relaxed text-red-700 dark:text-red-300">
            {{
              translations.account?.deleteAccountBody ||
              'Permanently delete your Beaver Account and all data on the server. Local notes stay on this device.'
            }}
          </p>
        </div>
        <div v-if="!deletingAccount" class="self-end">
          <ui-button variant="danger" @click="openDeleteAccount">
            {{ translations.account?.deleteAccount || 'Delete account' }}
          </ui-button>
        </div>
        <div v-else class="flex flex-col gap-2">
          <ui-input
            v-model="deletePassword"
            type="password"
            class="w-full"
            :placeholder="
              translations.account?.confirmPasswordPlaceholder || 'Password'
            "
            @keyup.enter="confirmDeleteAccount"
          />
          <div class="flex gap-2 justify-end">
            <ui-button @click="cancelDeleteAccount">{{
              translations.dialog?.cancel || 'Cancel'
            }}</ui-button>
            <ui-button
              variant="danger"
              :loading="accountStore.busy"
              :disabled="accountStore.busy"
              @click="confirmDeleteAccount"
            >
              {{
                translations.account?.deleteAccountConfirm || 'Delete forever'
              }}
            </ui-button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script>
import { computed, ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useDialog } from '@/lib/dialog';
import { useTranslations } from '@/composable/useTranslations';
import { useSettingsAccount } from '@/composable/useSettingsAccount';
import { useAccountStore } from '@/store/account';
import { PLAN_NAMES } from '@/lib/api/types';
import { isKeyLoaded } from '@/utils/crypto/encryption.js';

export default {
  setup() {
    const router = useRouter();
    const dialog = useDialog();
    const { translations } = useTranslations();
    const accountStore = useAccountStore();
    const account = useSettingsAccount({ dialog, translations });

    const showVaultImportPrompt = ref(false);

    async function checkVaultImportNeeded() {
      if (!accountStore.isAuthenticated) {
        showVaultImportPrompt.value = false;
        return;
      }
      // Already has encryption key loaded — no prompt needed
      if (isKeyLoaded()) {
        showVaultImportPrompt.value = false;
        return;
      }
      try {
        const { fetchCloudKeyParams } = await import('@/utils/sync/vault-key-params.js');
        const { detectRemoteVaultJoin } = await import('@/utils/onboarding/remote-vault-join.js');
        const { hasRemoteVaultKeyParams } = await import('@/utils/crypto/encryption.js');
        const hasVault = await detectRemoteVaultJoin({
          fetchCloudKeyParams,
          hasRemoteVaultKeyParams,
        }).catch(() => false);
        showVaultImportPrompt.value = hasVault;
      } catch {
        showVaultImportPrompt.value = false;
      }
    }

    function goToSecurity() {
      router.push('/settings/security');
    }

    async function importVaultDialog() {
      dialog.confirm({
        title: translations.value.account?.importVaultTitle || 'Import vault from sync',
        body: translations.value.account?.importVaultBody || 'Importing will replace this device\'s encryption key. Notes encrypted with a different key may no longer be readable.',
        icon: 'riShieldKeyholeLine',
        okText: translations.value.account?.importVault || 'Import',
        cancelText: translations.value.dialog?.cancel || 'Cancel',
        onConfirm: () => {
          dialog.prompt({
            title: translations.value.account?.vaultPasswordTitle || 'Enter vault password',
            body: translations.value.account?.vaultPasswordBody || 'Enter the password for the existing encrypted vault in your sync source.',
            icon: 'riLockLine',
            okText: translations.value.account?.importVault || 'Import',
            cancelText: translations.value.dialog?.cancel || 'Cancel',
            placeholder: translations.value.settings?.password || 'Vault password',
            password: true,
            onConfirm: async (pass) => {
              if (!pass) {
                dialog.alert({
                  title: translations.value.settings?.alertTitle || 'Alert',
                  body: translations.value.settings?.invalidPassword || 'Enter the vault password.',
                  okText: translations.value.dialog?.close || 'Close',
                });
                return;
              }
              try {
                const { adoptVaultKey } = await import('@/utils/crypto/encryption.js');
                const res = await adoptVaultKey(pass);
                if (!res.ok) {
                  dialog.alert({
                    title: translations.value.settings?.alertTitle || 'Alert',
                    body: res.error || 'Failed to import the vault. Check the password.',
                    okText: translations.value.dialog?.close || 'Close',
                  });
                  return;
                }
                showVaultImportPrompt.value = false;
                dialog.alert({
                  title: translations.value.account?.vaultImported || 'Vault imported',
                  body: translations.value.account?.vaultImportedBody || 'The vault has been imported. The app will reload.',
                  okText: translations.value.dialog?.close || 'Close',
                  onConfirm: () => window.location.reload(),
                });
              } catch (e) {
                dialog.alert({
                  title: translations.value.settings?.alertTitle || 'Alert',
                  body: e?.message || 'Failed to import the vault.',
                  okText: translations.value.dialog?.close || 'Close',
                });
              }
            },
          });
        },
      });
    }

    onMounted(() => {
      checkVaultImportNeeded();
    });

    const seedPhaseLabel = computed(() => {
      const phase = accountStore.seedProgress?.phase;
      if (phase === 'presign') return 'Preparing...';
      if (phase === 'snapshots') return 'Uploading notes...';
      if (phase === 'assets') return 'Uploading assets...';
      if (phase === 'finalizing') return 'Finalizing...';
      if (phase === 'done') return 'Complete';
      return 'Setting up...';
    });

    const seedProgressPercent = computed(() => {
      const { uploaded, total } = accountStore.seedProgress || {};
      if (!total) return 0;
      return Math.min(100, Math.round((uploaded / total) * 100));
    });

    return {
      translations,
      PLAN_NAMES,
      accountStore,
      seedPhaseLabel,
      seedProgressPercent,
      showVaultImportPrompt,
      goToSecurity,
      importVaultDialog,
      ...account,
    };
  },
};
</script>
