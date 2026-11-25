<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="general mb-14 w-full max-w-xl space-y-6">
    <!-- Account Switcher -->
    <settings-group
      v-if="!addingAccount && (accounts.length || !accountStore.isAnonymous)"
      :title="translations.account?.accounts || 'Accounts'"
    >
      <!-- Current account -->
      <div
        v-if="!accountStore.isAnonymous"
        data-testid="account-manager-active"
        class="flex flex-wrap items-center gap-3 px-4 py-3.5"
      >
        <ui-user-avatar :name="displayName" :size="40" class="shrink-0" />
        <div class="min-w-[10rem] flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <p
              class="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200"
            >
              {{ displayName }}
            </p>
            <span
              v-if="accountStore.profile?.emailVerified === true"
              class="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700 dark:bg-green-900/40 dark:text-green-300"
            >
              {{ translations.account?.verified || 'Verified' }}
            </span>
          </div>
          <p
            class="mt-0.5 truncate text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
          >
            <template v-if="accountStore.profile?.username">
              @{{ accountStore.profile.username }}
            </template>
            <template v-else-if="accountStore.profile?.email">
              {{ accountStore.profile.email }}
            </template>
            <template v-if="accountStore.profile?.createdAt">
              ·
              {{ translations.account?.memberSince || 'Member since' }}
              {{
                new Date(accountStore.profile.createdAt).toLocaleDateString()
              }}
            </template>
          </p>
        </div>
        <div class="flex shrink-0 gap-2">
          <ui-button variant="secondary" @click="startEditUsername">
            {{ translations.account?.edit || 'Edit' }}
          </ui-button>
          <ui-button @click="handleSignOut">
            {{ translations.account?.signOut || 'Sign out' }}
          </ui-button>
        </div>
      </div>

      <!-- Sync status -->
      <template v-if="!accountStore.isAnonymous && accountStore.seedStatus">
        <div
          v-if="accountStore.seedStatus === 'seeding'"
          class="beaver-sync-ready space-y-3 px-4 py-3.5"
        >
          <div class="flex items-center gap-3">
            <ui-spinner size="18" />
            <p
              class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
            >
              {{ seedPhaseLabel }}
            </p>
          </div>
          <div
            class="flex justify-between text-xs tabular-nums text-neutral-600 dark:text-neutral-400"
          >
            <span>{{ seedPhaseLabel }}</span>
            <span>
              {{ accountStore.seedProgress.uploaded }} /
              {{ accountStore.seedProgress.total }}
            </span>
          </div>
          <ui-progress-bar :value="seedProgressPercent" />
        </div>

        <div
          v-else-if="accountStore.seedStatus === 'done'"
          class="beaver-sync-ready flex items-center gap-2.5 bg-green-50 px-4 py-3 dark:bg-green-950/30"
        >
          <v-remixicon
            name="riCloudLine"
            size="18"
            class="text-green-600 dark:text-green-400"
          />
          <p class="text-sm font-medium text-green-800 dark:text-green-200">
            {{ tr.cloudSyncReady || 'Cloud sync ready' }}
          </p>
        </div>

        <div
          v-else-if="accountStore.seedStatus === 'error'"
          class="beaver-sync-ready space-y-2 px-4 py-3.5"
        >
          <ui-status-text tone="error" size="sm" icon="riErrorWarningLine">
            {{
              accountStore.seedError ||
              tr.syncSetupFailed ||
              'Sync setup failed'
            }}
          </ui-status-text>
          <div class="flex flex-wrap gap-2">
            <ui-button
              size="sm"
              :loading="seedRetrying"
              :disabled="seedRetrying"
              @click="retrySeed"
            >
              {{ tr.retrySyncSetup || 'Retry' }}
            </ui-button>
            <ui-button size="sm" @click="copyLogPath">
              {{
                logCopied
                  ? tr.logPathCopied || 'Log path copied'
                  : tr.copyLogPath || 'Copy log path'
              }}
            </ui-button>
          </div>
        </div>
      </template>

      <!-- Other accounts on this device -->
      <div
        v-for="acct in visibleAccounts"
        :key="acct.id"
        class="flex items-center gap-3 px-4 py-3.5"
      >
        <button
          class="focus-visible:outline-none focus-visible:ring-2 ring-secondary flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left"
          :data-testid="
            acct.id === activeAccountId
              ? 'account-manager-active'
              : 'account-manager-option'
          "
          @click="selectAccount(acct.id)"
        >
          <ui-user-avatar
            :name="accountLabel(acct)"
            :size="40"
            :class="acct.id === activeAccountId ? 'ring-2 ring-primary' : ''"
          />
          <span class="min-w-0 flex-1">
            <span
              class="block truncate text-sm"
              :class="
                acct.id === activeAccountId
                  ? 'font-medium text-primary'
                  : 'text-neutral-700 dark:text-neutral-300'
              "
            >
              {{ accountLabel(acct) }}
            </span>
            <span
              class="mt-0.5 block truncate text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
            >
              {{ planLabel(accountPlan(acct)) }} · {{ acct.serverUrl }}
            </span>
          </span>
          <v-remixicon
            v-if="acct.id === activeAccountId"
            name="riCheckLine"
            size="16"
            class="shrink-0 text-primary"
          />
        </button>

        <button
          class="focus-visible:outline-none focus-visible:ring-2 ring-secondary shrink-0 rounded-md px-2 py-1 text-xs font-medium text-neutral-500 transition-colors hover:text-red-500 dark:text-neutral-400 dark:hover:text-red-400"
          @click="promptSignOutAccount(acct)"
        >
          {{ translations.account?.signOut || 'Sign out' }}
        </button>
      </div>

      <!-- Add account -->
      <div v-if="accounts.length" class="px-4 py-3.5">
        <button
          class="focus-visible:outline-none focus-visible:ring-2 ring-secondary flex items-center gap-2 rounded-lg text-sm font-medium text-primary"
          @click="addAccount"
        >
          <v-remixicon name="riAddLine" size="16" />
          {{ translations.account?.addAccount || 'Add account' }}
        </button>
      </div>
    </settings-group>

    <!-- ───────────── Anonymous / adding account ───────────── -->
    <section v-if="accountStore.isAnonymous || addingAccount">
      <ui-card padding="p-0">
        <div class="px-6 pb-6 pt-5">
          <!-- Back -->
          <button
            v-if="authView !== 'welcome'"
            type="button"
            class="focus-visible:outline-none focus-visible:ring-2 ring-secondary -ml-1 mb-2 flex items-center gap-1 rounded text-xs font-medium text-neutral-500 hover:text-primary dark:text-neutral-400"
            @click="goBack"
          >
            <v-remixicon name="riArrowLeftSLine" size="16" />
            {{ translations.account?.back || 'Back' }}
          </button>
          <div v-else class="h-5" />

          <!-- Header -->
          <div class="flex flex-col items-center text-center">
            <ui-beaver-character
              :class="authView === 'welcome' ? 'w-20' : 'w-12'"
            />
            <h3
              class="mt-3 text-base font-semibold text-neutral-900 dark:text-neutral-100"
            >
              {{ authTitle }}
            </h3>
            <p
              class="mt-1 max-w-xs text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
            >
              {{ authSubtitle }}
            </p>
          </div>

          <!-- Welcome -->
          <div v-if="authView === 'welcome'" class="mt-6 flex flex-col gap-2">
            <ui-button
              variant="primary"
              class="w-full"
              @click="openView('signin')"
            >
              {{ translations.account?.signIn || 'Sign in' }}
            </ui-button>
            <ui-button class="w-full" @click="openView('create')">
              {{ translations.account?.createAccount || 'Create account' }}
            </ui-button>
            <button
              v-if="addingAccount"
              type="button"
              class="focus-visible:outline-none focus-visible:ring-2 ring-secondary mt-2 self-center rounded text-xs font-medium text-neutral-500 hover:text-primary dark:text-neutral-400"
              @click="cancelAddAccount"
            >
              {{ translations.account?.cancel || 'Cancel' }}
            </button>
          </div>

          <!-- Sign in -->
          <div
            v-else-if="authView === 'signin'"
            class="mt-6 flex flex-col gap-2"
          >
            <template v-if="method === 'passkey'">
              <ui-button
                variant="primary"
                class="w-full"
                :loading="accountStore.busy"
                :disabled="accountStore.busy"
                @click="handleSignInWithPasskey"
              >
                <v-remixicon name="riFingerprintLine" class="mr-1" />
                {{ tr.signInWithPasskey || 'Continue with passkey' }}
              </ui-button>
            </template>
            <template v-else>
              <ui-input
                v-model="signInEmail"
                type="email"
                prepend-icon="riMailLine"
                class="w-full"
                :placeholder="translations.account?.emailPlaceholder || 'Email'"
                :aria-label="translations.account?.emailPlaceholder || 'Email'"
              />
              <ui-input
                v-model="signInPassword"
                :password="true"
                prepend-icon="riLockPasswordLine"
                class="w-full"
                :placeholder="
                  translations.account?.passwordPlaceholder || 'Password'
                "
                :aria-label="
                  translations.account?.passwordPlaceholder || 'Password'
                "
                @keyup.enter="handleSignInWithPassword"
              />
              <ui-button
                variant="primary"
                class="w-full"
                :loading="accountStore.busy"
                :disabled="accountStore.busy"
                @click="handleSignInWithPassword"
              >
                {{ translations.account?.signInWithPassword || 'Sign in' }}
              </ui-button>
              <button
                type="button"
                class="focus-visible:outline-none focus-visible:ring-2 ring-secondary self-center rounded text-xs text-neutral-500 hover:text-primary dark:text-neutral-400"
                @click="openForgot"
              >
                {{ tr.forgotPassword || 'Forgot password?' }}
              </button>
            </template>
          </div>

          <!-- Create account -->
          <div
            v-else-if="authView === 'create'"
            class="mt-6 flex flex-col gap-2"
          >
            <template v-if="method === 'passkey'">
              <ui-input
                v-model="passkeyEmail"
                type="email"
                prepend-icon="riMailLine"
                class="w-full"
                :placeholder="
                  translations.account?.emailPlaceholder || 'Email (optional)'
                "
                :aria-label="
                  translations.account?.emailPlaceholder || 'Email (optional)'
                "
              />
              <ui-button
                variant="primary"
                class="w-full"
                :loading="accountStore.busy"
                :disabled="accountStore.busy"
                @click="handleSignUpWithPasskey"
              >
                <v-remixicon name="riFingerprintLine" class="mr-1" />
                {{ tr.createWithPasskey || 'Create with passkey' }}
              </ui-button>
            </template>
            <template v-else>
              <ui-input
                v-model="signInEmail"
                type="email"
                prepend-icon="riMailLine"
                class="w-full"
                :placeholder="translations.account?.emailPlaceholder || 'Email'"
                :aria-label="translations.account?.emailPlaceholder || 'Email'"
              />
              <ui-input
                v-model="signInPassword"
                :password="true"
                prepend-icon="riLockPasswordLine"
                class="w-full"
                :placeholder="
                  translations.account?.passwordPlaceholder || 'Password'
                "
                :aria-label="
                  translations.account?.passwordPlaceholder || 'Password'
                "
                @keyup.enter="handleSignUpWithPassword"
              />
              <ui-button
                variant="primary"
                class="w-full"
                :loading="accountStore.busy"
                :disabled="accountStore.busy"
                @click="handleSignUpWithPassword"
              >
                {{ translations.account?.createAccount || 'Create account' }}
              </ui-button>
            </template>
          </div>

          <!-- Forgot password -->
          <div
            v-else-if="authView === 'forgot'"
            class="mt-6 flex flex-col gap-2"
          >
            <ui-input
              v-model="forgotEmail"
              type="email"
              prepend-icon="riMailLine"
              class="w-full"
              :placeholder="tr.emailPlaceholder || 'Email'"
              :aria-label="tr.emailPlaceholder || 'Email'"
              @keyup.enter="handleForgot"
            />
            <ui-button
              variant="primary"
              class="w-full"
              :loading="forgotBusy"
              @click="handleForgot"
            >
              {{ tr.sendResetLink || 'Send reset link' }}
            </ui-button>
            <ui-status-text
              v-if="forgotMessage"
              size="xs"
              :tone="forgotSent ? 'success' : 'warning'"
              role="status"
            >
              {{ forgotMessage }}
            </ui-status-text>
          </div>

          <!-- Method switch (sign in / create only) -->
          <button
            v-if="
              passkeysAvailable &&
              (authView === 'signin' || authView === 'create')
            "
            type="button"
            class="focus-visible:outline-none focus-visible:ring-2 ring-secondary mt-4 block w-full rounded text-center text-xs font-medium text-primary hover:underline"
            @click="method = method === 'passkey' ? 'password' : 'passkey'"
          >
            {{
              method === 'passkey'
                ? tr.usePassword || 'Use a password instead'
                : tr.usePasskey || 'Use a passkey instead'
            }}
          </button>

          <ui-status-text
            v-if="accountStore.error"
            tone="error"
            role="alert"
            class="mt-4"
          >
            {{ accountStore.error }}
          </ui-status-text>
        </div>
      </ui-card>
    </section>

    <!-- ───────────── Signed in ───────────── -->
    <section v-else class="space-y-7">
      <!-- Alerts -->
      <section
        v-if="
          (storageNearLimit && !storageWarningDismissed) ||
          showVaultImportPrompt ||
          (accountStore.profile?.emailVerified === false &&
            !emailBannerDismissed)
        "
        class="space-y-3"
      >
        <!-- Storage almost full — kept first in DOM: the billing test clicks
             the first banner's primary action and expects reason 'storage'. -->
        <!-- Pure upsell this release: hidden outside dev, no purchase path -->
        <div
          v-if="storageNearLimit && !storageWarningDismissed && devMode"
          data-testid="storage-quota-warning"
        >
          <settings-alert
            tone="warning"
            icon="riErrorWarningLine"
            :content="
              tr.storageWarning ||
              'You are close to your storage limit. Upgrade for more space.'
            "
            :primary-text="tr.upgrade || 'Upgrade'"
            :secondary-text="translations.dialog?.close || 'Dismiss'"
            @button-1="openPaywall('storage')"
            @button-2="storageWarningDismissed = true"
          />
        </div>

        <!-- Vault detected -->
        <div v-if="showVaultImportPrompt">
          <settings-alert
            icon="riShieldKeyholeLine"
            :content="
              translations.account?.vaultDetectedBody ||
              'A vault was found in your sync source. Import it to unlock your notes.'
            "
            :primary-text="translations.account?.importVault || 'Import'"
            :secondary-text="translations.account?.later || 'Later'"
            @button-1="importVaultDialog"
            @button-2="showVaultImportPrompt = false"
          />
        </div>

        <!-- Email verification -->
        <div
          v-if="
            accountStore.profile?.emailVerified === false &&
            !emailBannerDismissed
          "
        >
          <settings-alert
            icon="riMailLine"
            :content="
              tr.verifyToInvite || 'Verify your email to invite collaborators.'
            "
            :primary-text="
              emailVerifyCooldown > 0
                ? tr.resendWithCooldown
                  ? fmt('resendWithCooldown', { seconds: emailVerifyCooldown })
                  : `Resend (${emailVerifyCooldown}s)`
                : tr.verifyEmail || 'Verify email'
            "
            :secondary-text="translations.dialog?.close || 'Dismiss'"
            @button-1="handleRequestEmailVerification"
            @button-2="emailBannerDismissed = true"
          />
        </div>
      </section>

      <!-- Plan & storage -->
      <section>
        <settings-group :title="translations.account?.plan || 'Plan & storage'">
          <settings-row
            control-id="account-plan"
            :label="translations.account?.currentPlan || 'Current plan'"
            :description="planDescription"
          >
            <ui-button
              v-if="!accountStore.isPaidPlan && devMode"
              variant="primary"
              data-testid="upgrade-choose-plan"
              @click="openPaywall('settings')"
            >
              {{ tr.choosePlan || 'Choose a plan' }}
            </ui-button>
            <ui-button
              v-else-if="accountStore.isPaidPlan"
              :loading="billingBusy"
              :disabled="billingBusy"
              :aria-label="tr.manageBilling || 'Manage billing'"
              @click="handleManageBilling"
            >
              <v-remixicon name="riExternalLinkLine" class="mr-1" />
              {{
                tr.manageBilling ||
                translations.account?.managePlan ||
                'Manage billing'
              }}
            </ui-button>
          </settings-row>

          <settings-row
            v-if="
              accountStore.subscription?.storage &&
              accountStore.plan !== PLAN_NAMES.ENTERPRISE
            "
            :label="translations.account?.storage || 'Storage'"
            control-class="w-36 sm:w-48"
          >
            <div class="w-full">
              <p
                class="mb-1.5 text-right text-xs tabular-nums text-neutral-500 dark:text-neutral-400"
              >
                <span
                  class="font-semibold text-neutral-800 dark:text-neutral-200"
                >
                  {{
                    (
                      accountStore.subscription.storage.usedBytes / 1073741824
                    ).toFixed(1)
                  }}
                </span>
                /
                {{
                  (
                    accountStore.subscription.storage.quotaBytes / 1073741824
                  ).toFixed(0)
                }}
                GB
              </p>
              <ui-progress-bar
                :value="storageUsedPercent"
                :tone="storageNearLimit ? 'warning' : 'primary'"
              />
            </div>
          </settings-row>
        </settings-group>

        <!-- Billing feedback -->
        <div v-if="billingMessage" class="mt-3 px-1">
          <ui-status-text
            :tone="billingSuccess ? 'success' : 'warning'"
            size="xs"
          >
            {{ billingMessage }}
          </ui-status-text>
        </div>

        <p
          v-if="accountStore.isPaidPlan"
          class="mt-3 px-1 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
        >
          {{
            tr.manageBillingDescription ||
            'Manage payment method, invoices, or cancel.'
          }}
        </p>
        <p
          v-else-if="devMode"
          class="mt-3 px-1 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
        >
          {{ upgradeDescription }}
        </p>

        <!-- Cloud sync CTA -->
        <div class="beaver-sync-ready mt-3">
          <div
            v-if="!accountStore.isPaidPlan && devMode"
            class="flex flex-col gap-3 rounded-xl border border-dashed border-neutral-300 px-5 py-4 dark:border-neutral-700"
          >
            <div>
              <p
                class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
              >
                {{
                  translations.account?.cloudSyncCtaHeading ||
                  `Cloud sync is part of ${planLabel(PLAN_NAMES.STARTER)}.`
                }}
              </p>
              <p
                class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
              >
                {{
                  translations.account?.cloudSyncCtaBody ||
                  `Upgrade to ${planLabel(PLAN_NAMES.STARTER)} or higher to sync notes across devices through Beaver Sync. Your current folder sync keeps working in the meantime.`
                }}
              </p>
            </div>
            <div>
              <ui-button
                size="sm"
                variant="primary"
                data-testid="cloud-sync-upgrade"
                @click="openPaywall('sync')"
              >
                {{ tr.upgrade || 'Upgrade' }}
              </ui-button>
            </div>
          </div>
        </div>
      </section>

      <!-- Security -->
      <settings-group :title="translations.account?.security || 'Security'">
        <settings-row
          control-id="account-change-password"
          :label="tr.changePassword || 'Change password'"
          :description="
            tr.changePasswordDescription ||
            'Verifies current password, rotates, revokes other sessions.'
          "
        >
          <ui-button variant="secondary" @click="passwordModalOpen = true">
            {{ tr.changePassword || 'Change' }}
          </ui-button>
        </settings-row>

        <settings-row
          control-id="account-recovery-code"
          :label="tr.recoveryCode || 'Account recovery code'"
          :description="
            tr.recoveryCodeDescription ||
            'Restores account sign-in if you lose your passkeys. Regenerating invalidates the old code. It does not unlock your notes.'
          "
        >
          <ui-button
            variant="secondary"
            :aria-label="
              recoveryCode
                ? tr.regenerate || 'Regenerate'
                : tr.generate || 'Generate'
            "
            @click="recoveryModalOpen = true"
          >
            {{
              recoveryCode
                ? tr.regenerate || 'Regenerate'
                : tr.generate || 'Generate'
            }}
          </ui-button>
        </settings-row>

        <settings-row
          :label="
            translations.account?.signOutEverywhereTitle ||
            'Sign out everywhere'
          "
          :description="
            translations.account?.signOutEverywhereBody ||
            'Revoke all other devices. This device stays signed in.'
          "
        >
          <ui-button variant="danger" @click="handleSignOutEverywhere">
            {{ translations.account?.signOutEverywhere || 'Sign out' }}
          </ui-button>
        </settings-row>
      </settings-group>

      <!-- Devices -->
      <section>
        <div class="mb-2.5 flex items-center justify-between gap-3 px-1">
          <h2 class="section-label !mb-0">
            {{ translations.account?.devices || 'Your devices' }}
          </h2>
          <button
            class="focus-visible:outline-none focus-visible:ring-2 ring-secondary rounded text-xs font-semibold text-primary hover:underline"
            @click="refreshDevices"
          >
            {{ translations.settings?.syncNow || 'Refresh' }}
          </button>
        </div>

        <settings-group>
          <div
            v-if="loadingSessions && !unifiedDevices.length"
            class="flex justify-center px-4 py-6"
          >
            <ui-spinner size="20" color="text-neutral-400" />
          </div>
          <p
            v-else-if="!unifiedDevices.length"
            class="px-4 py-3.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
          >
            {{ translations.account?.noSessions || 'No active devices' }}
          </p>
          <div
            v-for="entry in unifiedDevices"
            :key="entry.key"
            class="flex items-center gap-3 px-4 py-3.5"
          >
            <span
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800"
              aria-hidden="true"
            >
              <v-remixicon
                :name="platformIcon(entry.platform)"
                size="18"
                class="text-neutral-500 dark:text-neutral-400"
              />
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <p
                  class="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200"
                >
                  {{ entry.name }}
                </p>
                <span
                  v-if="entry.id && entry.id === thisDeviceId"
                  class="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700 dark:bg-green-900/40 dark:text-green-300"
                >
                  {{ translations.account?.thisDevice || 'This device' }}
                </span>
              </div>
              <p
                class="truncate text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
                :title="entry.id || ''"
              >
                {{ platformLabel(entry.platform) }}
                <template v-if="entry.lastSeen"
                  >· {{ fmtLastSeen(entry.lastSeen) }}</template
                >
              </p>
            </div>
            <ui-button
              icon
              variant="danger"
              :aria-label="
                translations.account?.revokeDevice || 'Revoke device'
              "
              @click="revokeUnified(entry)"
            >
              <v-remixicon name="riDeleteBin6Line" />
            </ui-button>
          </div>
        </settings-group>
      </section>

      <!-- Privacy -->
      <settings-group :title="translations.account?.privacy || 'Privacy'">
        <settings-row
          control-id="account-export"
          :label="translations.account?.exportData || 'Export account data'"
          :description="
            translations.account?.exportDataBody ||
            'Download a copy of your account information.'
          "
        >
          <ui-button variant="secondary" @click="exportAccountData">
            <v-remixicon name="riDownloadLine" class="mr-1" />
            {{ translations.account?.export || 'Export' }}
          </ui-button>
        </settings-row>
      </settings-group>

      <!-- Advanced (collapsed) -->
      <section class="beaver-sync-ready">
        <ui-disclosure v-model="showAdvanced" max-open="max-h-80">
          <template #title>
            <span
              class="px-1 text-sm font-semibold text-neutral-600 dark:text-neutral-300"
            >
              {{ translations.account?.advanced || 'Advanced' }}
            </span>
          </template>
          <div class="pt-2">
            <settings-group>
              <settings-row v-if="!showServerUrlEditor" label="Sync server">
                <template #description>
                  <span
                    class="block truncate font-mono text-sm text-neutral-800 dark:text-neutral-200"
                  >
                    {{ accountStore.serverUrl }}
                  </span>
                  <span
                    class="mt-1.5 block text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
                  >
                    {{
                      translations.account?.serverHint ||
                      'Change this to point at a self-hosted Beaver Sync instance.'
                    }}
                  </span>
                </template>
                <ui-button @click="showServerUrlEditor = true">
                  {{ translations.settings?.change || 'Change' }}
                </ui-button>
              </settings-row>

              <div v-else class="flex flex-col gap-2 px-4 py-3.5">
                <ui-input
                  v-model="draftServerUrl"
                  class="w-full"
                  prepend-icon="riServerLine"
                  :placeholder="defaultServerUrl"
                />
                <div class="flex flex-wrap justify-end gap-2">
                  <ui-button @click="showServerUrlEditor = false">
                    {{ translations.dialog?.cancel || 'Cancel' }}
                  </ui-button>
                  <ui-button variant="secondary" @click="resetServerUrl">
                    {{ translations.account?.useDefault || 'Use default' }}
                  </ui-button>
                  <ui-button
                    variant="primary"
                    :loading="accountStore.busy"
                    @click="saveServerUrl"
                  >
                    {{ translations.settings?.enable || 'Save' }}
                  </ui-button>
                </div>
              </div>
            </settings-group>
          </div>
        </ui-disclosure>
      </section>

      <!-- Danger zone -->
      <settings-group
        danger
        :title="translations.account?.deleteAccount || 'Delete Beaver Account'"
      >
        <div class="px-4 py-3.5">
          <p
            class="text-xs leading-relaxed text-red-800/70 dark:text-red-200/70"
          >
            {{
              translations.account?.deleteAccountBody ||
              'Permanently delete your Beaver Account and all data on the server. Local notes stay on this device.'
            }}
          </p>

          <div v-if="!deletingAccount" class="mt-3 flex justify-end">
            <ui-button variant="danger" @click="openDeleteAccount">
              <v-remixicon name="riDeleteBin6Line" class="mr-1" />
              {{ translations.account?.deleteAccount || 'Delete account' }}
            </ui-button>
          </div>
          <div v-else class="mt-3 flex flex-col gap-2">
            <ui-input
              v-model="deletePassword"
              :password="true"
              prepend-icon="riLockPasswordLine"
              class="w-full"
              :placeholder="
                translations.account?.confirmPasswordPlaceholder || 'Password'
              "
              @keyup.enter="confirmDeleteAccount"
            />
            <div class="flex justify-end gap-2">
              <ui-button @click="cancelDeleteAccount">
                {{ translations.dialog?.cancel || 'Cancel' }}
              </ui-button>
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
      </settings-group>

      <!-- Edit username dialog -->
      <ui-modal
        v-model="editingUsername"
        content-class="max-w-md"
        icon="riUserLine"
        :title="translations.account?.editUsername || 'Edit username'"
      >
        <template v-if="editingUsername">
          <div class="flex flex-col gap-2">
            <p class="text-sm text-neutral-500 dark:text-neutral-400">
              {{
                translations.account?.usernameHint ||
                'Shown on your profile and used to sign in.'
              }}
            </p>
            <ui-input
              v-model="draftUsername"
              class="w-full"
              prepend-icon="riUserLine"
              placeholder="Username"
              @keyup.enter="saveUsername"
            />
            <div class="flex justify-end gap-2">
              <ui-button variant="secondary" @click="cancelEditUsername">
                {{ translations.dialog?.cancel || 'Cancel' }}
              </ui-button>
              <ui-button
                variant="primary"
                :loading="accountStore.busy"
                @click="saveUsername"
              >
                {{ translations.settings?.enable || 'Save' }}
              </ui-button>
            </div>
          </div>
        </template>
      </ui-modal>

      <!-- Change password dialog -->
      <ui-modal
        v-model="passwordModalOpen"
        content-class="max-w-md"
        icon="riLockPasswordLine"
        :title="tr.changePassword || 'Change password'"
      >
        <p class="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
          Use at least 12 characters. Other sessions will be signed out.
        </p>
        <div class="flex flex-col gap-2">
          <ui-input
            v-model="changeCurrent"
            :password="true"
            prepend-icon="riLockPasswordLine"
            :placeholder="tr.currentPasswordPlaceholder || 'Current password'"
            :aria-label="tr.currentPasswordPlaceholder || 'Current password'"
            class="w-full"
          />
          <ui-input
            v-model="changeNew"
            :password="true"
            prepend-icon="riLockPasswordLine"
            :placeholder="
              tr.newPasswordPlaceholder || 'New password (min 12 chars)'
            "
            :aria-label="
              tr.newPasswordPlaceholder || 'New password (min 12 chars)'
            "
            class="w-full"
          />
          <ui-input
            v-model="changeConfirm"
            :password="true"
            prepend-icon="riLockPasswordLine"
            :placeholder="
              tr.confirmPasswordPlaceholder || 'Confirm new password'
            "
            :aria-label="
              tr.confirmPasswordPlaceholder || 'Confirm new password'
            "
            class="w-full"
          />
          <ui-status-text
            v-if="changeMessage"
            size="xs"
            :tone="changeSuccess ? 'success' : 'error'"
            role="status"
          >
            {{ changeMessage }}
          </ui-status-text>
          <ui-button
            variant="primary"
            class="mt-1 w-full"
            :loading="changeBusy"
            :aria-label="tr.changePassword || 'Change password'"
            @click="handleChangePassword"
          >
            {{ tr.changePassword || 'Change password' }}
          </ui-button>
        </div>
      </ui-modal>

      <!-- Recovery code dialog -->
      <ui-modal
        v-model="recoveryModalOpen"
        content-class="max-w-md"
        icon="riKey2Line"
        :title="tr.recoveryCode || 'Account recovery code'"
      >
        <div class="space-y-3">
          <p
            class="whitespace-pre-line text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
          >
            {{ whatUnlocks }}
          </p>
          <ui-button
            variant="primary"
            class="w-full"
            :loading="recoveryBusy"
            :aria-label="
              recoveryCode
                ? tr.regenerate || 'Regenerate'
                : tr.generate || 'Generate'
            "
            @click="handleGenerateRecoveryCode"
          >
            {{
              recoveryCode
                ? tr.regenerate || 'Regenerate'
                : tr.generate || 'Generate'
            }}
          </ui-button>
          <ui-card
            v-if="recoveryCode"
            bg="bg-amber-50 dark:bg-amber-900/20"
            radius="rounded-xl"
            padding="px-3 py-2"
            class="border-amber-200 dark:border-amber-800"
          >
            <p
              class="break-all font-mono text-xs text-amber-900 dark:text-amber-100"
            >
              {{ recoveryCode }}
            </p>
            <p class="mt-1 text-xs text-amber-700 dark:text-amber-400">
              {{
                tr.recoveryCodeHint ||
                'Copy now: this code will not be shown again. Store it securely.'
              }}
            </p>
          </ui-card>
        </div>
      </ui-modal>
    </section>
  </div>
</template>

<script>
import { computed, ref, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDialog } from '@/lib/dialog';
import { useTranslations } from '@/composable/useTranslations';
import { useSettingsAccount } from '@/composable/useSettingsAccount';
import { signOutAccount, switchAccount } from '@/composable/useAccountAuth';
import { getActiveAccountId, listAccounts } from '@/lib/accounts-index';
import { useAccountStore } from '@/store/account';
import { PLAN_NAMES, planLabel, planLimitsText } from '@/lib/api/types';
import {
  generateRecoveryCode as apiGenerateRecoveryCode,
  requestEmailVerification as apiRequestEmailVerification,
  changePassword as apiChangePassword,
  getAccount,
} from '@/lib/api/account';
import { createPortalSession } from '@/lib/api/billing';
import { openBillingUrl } from '@/lib/billing/external-url';
import { canUsePasskeys } from '@/lib/api/auth';
import { isMobileRuntime } from '@/lib/tauri/runtime';
import { localNoteCount } from '@/utils/notes/local-note-count.js';
import { deviceDisplayName, devicePlatform } from '@/utils/device/device-label';
import { getSyncDeviceId } from '@/utils/sync/sync-repository';
import { whatUnlocksWhat } from '@/utils/i18n/secrets.js';
import { usePaywall } from '@/utils/paywall';
import SettingsGroup from '@/components/settings/SettingsGroup.vue';
import SettingsRow from '@/components/settings/SettingsRow.vue';
import SettingsAlert from '@/components/settings/SettingsAlert.vue';

export default {
  components: { SettingsGroup, SettingsRow, SettingsAlert },
  setup() {
    const router = useRouter();
    const route = useRoute();
    const dialog = useDialog();
    const { translations } = useTranslations();
    const tr = computed(() => translations.value?.account || {});
    const whatUnlocks = computed(() => whatUnlocksWhat(translations.value));
    function fmt(key, params) {
      const raw = tr.value[key] ?? key;
      if (!params) return raw;
      return Object.entries(params).reduce(
        (s, [k, v]) => s.replace(`{${k}}`, String(v)),
        raw,
      );
    }
    const accountStore = useAccountStore();
    const account = useSettingsAccount({ dialog, translations });
    const unifiedDevices = computed(() => {
      const rows = [];
      const seen = new Set();
      const push = (id, row) => {
        if (id && seen.has(id)) return;
        if (id) seen.add(id);
        rows.push(row);
      };
      for (const device of accountStore.devices || []) {
        push(device.deviceId, {
          key: `device:${device.deviceId}`,
          id: device.deviceId || null,
          name: deviceDisplayName(device),
          platform: devicePlatform(device),
          lastSeen: device.lastSeen || null,
          kind: 'device',
          raw: device,
        });
      }
      for (const session of account.sessions.value || []) {
        push(session.deviceId || session.device_id || null, {
          key: `session:${session.id}`,
          id: session.deviceId || session.device_id || session.id || null,
          name: deviceDisplayName(session),
          platform: devicePlatform(session),
          lastSeen: session.lastSeenAt || session.createdAt || null,
          kind: 'session',
          raw: session,
        });
      }
      return rows;
    });

    function platformIcon(platform) {
      if (platform === 'mobile') return 'riSmartphoneLine';
      if (platform === 'tablet') return 'riTabletLine';
      return 'riComputerLine';
    }
    function platformLabel(platform) {
      if (platform === 'mobile') return 'Mobile';
      if (platform === 'tablet') return 'Tablet';
      return 'Desktop';
    }
    function fmtLastSeen(value) {
      if (!value) return '';
      try {
        return new Date(value).toLocaleString();
      } catch {
        return '';
      }
    }
    function revokeUnified(entry) {
      if (entry.kind === 'session') account.revokeSession(entry.raw);
      else account.handleRevokeDevice(entry.raw);
    }

    // Refresh covers both halves of unifiedDevices: auth sessions and the
    // server's device records.
    async function refreshDevices() {
      await account.loadSessions();
      try {
        const data = await getAccount({ baseUrl: accountStore.serverUrl });
        if (data) accountStore.setDevices(data.devices || []);
      } catch {}
    }

    // Return to a join/invite link after signing in (e.g. the join page sends
    // signed-out users here with `returnTo`).
    watch(
      () => accountStore.isAuthenticated,
      (authed) => {
        const returnTo = route.query?.returnTo;
        if (
          authed &&
          typeof returnTo === 'string' &&
          returnTo.startsWith('/')
        ) {
          router.push(returnTo);
        }
      },
    );

    const logCopied = ref(false);
    const seedRetrying = ref(false);
    async function retrySeed() {
      seedRetrying.value = true;
      try {
        await account.triggerSeed();
      } catch {}
      seedRetrying.value = false;
    }
    async function copyLogPath() {
      try {
        const { backend } = await import('@/lib/tauri-bridge');
        const path = await backend.invoke('log_file_path');
        await navigator.clipboard.writeText(
          path || 'Log file not initialized yet',
        );
        logCopied.value = true;
        setTimeout(() => {
          logCopied.value = false;
        }, 2000);
      } catch {
        logCopied.value = false;
      }
    }

    const showVaultImportPrompt = ref(false);
    const showAdvanced = ref(false);
    const storageWarningDismissed = ref(false);
    const emailBannerDismissed = ref(false);
    const displayName = computed(
      () => accountStore.profile?.username || accountStore.profile?.email || '',
    );
    const forgotEmail = ref('');
    const forgotBusy = ref(false);
    const forgotMessage = ref('');
    const forgotSent = ref(false);
    async function handleForgot() {
      forgotMessage.value = '';
      forgotSent.value = false;
      const email =
        forgotEmail.value.trim() || accountStore.profile?.email || '';
      if (!email) {
        forgotMessage.value = 'Enter your email.';
        return;
      }
      forgotBusy.value = true;
      try {
        const { requestPasswordReset } = await import('@/lib/api/auth');
        const res = await requestPasswordReset(email, {
          baseUrl: accountStore.serverUrl,
        });
        forgotMessage.value =
          res?.message ||
          'If an account exists for that email, you will receive a password reset link. Check your inbox (and spam folder).';
        forgotSent.value = true;
      } catch (e) {
        forgotMessage.value = e?.message || 'Failed.';
      } finally {
        forgotBusy.value = false;
      }
    }
    const changeCurrent = ref('');
    const changeNew = ref('');
    const changeConfirm = ref('');
    const changeBusy = ref(false);
    const changeMessage = ref('');
    const changeSuccess = ref(false);
    const passwordModalOpen = ref(false);
    const recoveryModalOpen = ref(false);
    async function handleChangePassword() {
      changeMessage.value = '';
      changeSuccess.value = false;
      if (!changeCurrent.value || !changeNew.value) {
        changeMessage.value = 'All fields required.';
        return;
      }
      if (changeNew.value.length < 12) {
        changeMessage.value = 'New password must be at least 12 characters.';
        return;
      }
      if (changeNew.value !== changeConfirm.value) {
        changeMessage.value = 'Passwords do not match.';
        return;
      }
      changeBusy.value = true;
      try {
        await apiChangePassword(changeCurrent.value, changeNew.value, {
          baseUrl: accountStore.serverUrl,
        });
        changeMessage.value = 'Password changed. Other sessions revoked.';
        changeSuccess.value = true;
        changeCurrent.value = '';
        changeNew.value = '';
        changeConfirm.value = '';
      } catch (e) {
        changeMessage.value = e?.message || 'Failed to change password.';
      } finally {
        changeBusy.value = false;
      }
    }
    const recoveryCode = ref('');
    const recoveryBusy = ref(false);
    let recoveryClearTimer = null;
    onUnmounted(() => {
      if (recoveryClearTimer) clearTimeout(recoveryClearTimer);
      recoveryCode.value = '';
    });
    const billingBusy = ref(false);
    const billingError = ref('');
    const billingMessage = ref('');
    const billingSuccess = ref(false);
    const isMobile = isMobileRuntime();
    const { open: openPaywall } = usePaywall();
    const devMode = import.meta.env.DEV;
    const paidFeaturesEnabled = devMode;
    const upgradeDescription = computed(() =>
      isMobile
        ? translations.value?.account?.upgradeDescriptionMobile ||
          'Choose a plan. Purchases are handled by your app store.'
        : translations.value?.account?.upgradeDescription ||
          'Choose a plan. Checkout opens in your browser (subscription activates via webhook).',
    );
    const passkeysAvailable = computed(() =>
      canUsePasskeys(accountStore.serverUrl),
    );
    // Warn before the hard limit so the user can upgrade instead of hitting a
    // silent sync failure. 85% leaves room to act.
    const QUOTA_WARN_PERCENT = 85;
    const storageUsedPercent = computed(() => {
      const storage = accountStore.subscription?.storage;
      if (storage?.quotaBytes) {
        return (storage.usedBytes / storage.quotaBytes) * 100;
      }
      return accountStore.storageUsedPercent || 0;
    });
    const storageNearLimit = computed(
      () =>
        !!accountStore.subscription?.storage &&
        storageUsedPercent.value >= QUOTA_WARN_PERCENT,
    );

    
    async function handleManageBilling() {
      if (isMobile) {
        const { useIapBilling } = await import('@/composable/useIapBilling');
        await useIapBilling({ accountStore }).openManage();
        return;
      }
      billingBusy.value = true;
      billingError.value = '';
      try {
        const res = await createPortalSession({
          baseUrl: accountStore.serverUrl,
        });
        const url = res?.url;
        if (!(await openBillingUrl(url, accountStore.serverUrl))) {
          billingError.value = 'Refusing to open an unexpected billing URL.';
          return;
        }
      } catch (e) {
        const msg = e?.message || 'Failed to open billing portal.';
        billingError.value = msg;
        dialog.alert({
          title: 'Billing portal failed',
          body: msg,
          okText: 'Close',
        });
      } finally {
        billingBusy.value = false;
      }
    }
    async function handleBillingReturn() {
      // Deep-link / fallback return handler: refetch profile/subscription
      try {
        const { useAccountAuth } = await import('@/composable/useAccountAuth');
        const auth = useAccountAuth();
        await auth.refreshProfile?.();
        billingMessage.value =
          'Billing return received. If you completed checkout, your subscription will activate shortly.';
        billingSuccess.value = true;
      } catch {
        // silent
      }
    }
    // Listen for deep-link billing return (beavernotes://billing/return)
    // Tauri deep-link plugin emits 'deep-link' events; also handle query param fallback
    onMounted(() => {
      try {
        const url = new URL(window.location.href);
        if (
          url.searchParams.get('session_id') ||
          url.searchParams.get('canceled') ||
          url.pathname.includes('billing/return')
        ) {
          handleBillingReturn();
        }
      } catch {}
      // lazy import deep-link listener if available
      import('@tauri-apps/plugin-deep-link')
        .then((m) => {
          const onOpenUrl = m.onOpenUrl || m.getCurrent || null;
          if (typeof onOpenUrl === 'function') {
            onOpenUrl((urls) => {
              const list = Array.isArray(urls) ? urls : [urls];
              if (list.some((u) => String(u).includes('billing/return')))
                handleBillingReturn();
            }).catch(() => {});
          }
        })
        .catch(() => {});
      // Deep link from the Team settings upgrade gate: open the shared paywall
      // with the plans view so the user picks the tier there. Paid plans are
      // hidden this release, so prod ignores the query.
      const requestedPlan = route.query?.upgrade;
      if (
        paidFeaturesEnabled &&
        typeof requestedPlan === 'string' &&
        Object.values(PLAN_NAMES).includes(requestedPlan)
      ) {
        openPaywall('settings');
      }
    });
    const emailVerifySending = ref(false);
    const emailVerifyCooldown = ref(0);
    let emailVerifyTimer = null;
    async function handleRequestEmailVerification() {
      if (emailVerifySending.value || emailVerifyCooldown.value > 0) return;
      emailVerifySending.value = true;
      try {
        await apiRequestEmailVerification({ baseUrl: accountStore.serverUrl });
        dialog.alert({
          title: 'Verification email sent',
          body: 'Check your inbox for the verification link (expires in 24 hours).',
          okText: 'Close',
        });
        emailVerifyCooldown.value = 60;
        emailVerifyTimer = setInterval(() => {
          emailVerifyCooldown.value -= 1;
          if (emailVerifyCooldown.value <= 0) {
            clearInterval(emailVerifyTimer);
            emailVerifyTimer = null;
          }
        }, 1000);
      } catch (e) {
        dialog.alert({
          title: 'Failed to send',
          body: e?.message || 'Failed to send verification email.',
          okText: 'Close',
        });
      } finally {
        emailVerifySending.value = false;
      }
    }

    // Vault differs from local manifest: hasRemoteVaultKeyParams authoritative, shows even with wrong local key. Refresh first.
    async function checkVaultImportNeeded() {
      if (!accountStore.isAuthenticated) {
        showVaultImportPrompt.value = false;
        return;
      }
      try {
        const { fetchCloudKeyParams } =
          await import('@/utils/sync/vault-key-params.js');
        const { hasRemoteVaultKeyParams } =
          await import('@/utils/crypto/encryption.js');
        await fetchCloudKeyParams({ force: true }).catch(() => null);
        showVaultImportPrompt.value = await hasRemoteVaultKeyParams();
      } catch {
        showVaultImportPrompt.value = false;
      }
    }

    function goToSecurity() {
      router.push('/settings');
    }

    async function importVaultDialog() {
      dialog.confirm({
        title:
          translations.value?.account?.importVaultTitle ||
          'Import vault from sync',
        body:
          `Importing merges this device's notes into the vault. ` +
          `${localNoteCount()} local note(s) are re-encrypted with the vault key and kept on both devices. ` +
          'A backup is saved before anything changes.',
        icon: 'riShieldKeyholeLine',
        okText: translations.value?.account?.importVault || 'Import',
        cancelText: translations.value.dialog?.cancel || 'Cancel',
        onConfirm: () => {
          dialog.prompt({
            title:
              translations.value?.account?.vaultKeyTitle || 'Enter vault key',
            body:
              translations.value?.account?.vaultKeyBody ||
              'Enter the vault key for the existing encrypted vault in your sync source.',
            icon: 'riLockLine',
            okText: translations.value?.account?.importVault || 'Import',
            cancelText: translations.value.dialog?.cancel || 'Cancel',
            placeholder:
              translations.value.settings?.vaultKeyPlaceholder || 'Vault key',
            password: true,
            onConfirm: async (pass) => {
              if (!pass) {
                dialog.alert({
                  title: translations.value.settings?.alertTitle || 'Alert',
                  body:
                    translations.value.settings?.invalidPassword ||
                    'Enter the vault key.',
                  okText: translations.value.dialog?.close || 'Close',
                });
                return;
              }
              try {
                const { adoptVaultKey } =
                  await import('@/utils/crypto/encryption.js');
                const { getFetchedCloudKeyParams } =
                  await import('@/utils/sync/vault-key-params.js');
                const fetched = getFetchedCloudKeyParams();
                const res = await adoptVaultKey(pass, fetched?.paramsBlob);
                if (!res.ok) {
                  dialog.alert({
                    title: translations.value.settings?.alertTitle || 'Alert',
                    body:
                      res.error ||
                      'Failed to import the vault. Check the vault key.',
                    okText: translations.value.dialog?.close || 'Close',
                  });
                  return;
                }
                showVaultImportPrompt.value = false;
                dialog.alert({
                  title:
                    translations.value?.account?.vaultImported ||
                    'Vault imported',
                  body:
                    translations.value?.account?.vaultImportedBody ||
                    'The vault has been imported. The app will reload.',
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

    async function handleGenerateRecoveryCode() {
      recoveryBusy.value = true;
      try {
        const res = await apiGenerateRecoveryCode({
          baseUrl: accountStore.serverUrl,
        });
        recoveryCode.value = res?.recoveryCode || '';
        // Auto-clear the displayed code so it does not linger in the DOM.
        if (recoveryClearTimer) clearTimeout(recoveryClearTimer);
        recoveryClearTimer = setTimeout(() => {
          recoveryCode.value = '';
          recoveryClearTimer = null;
        }, 120000);
        dialog.alert({
          title: 'Account recovery code generated',
          body:
            'Store this code securely: it will not be shown again. Regenerating invalidates the old code. It restores account sign-in only; notes need the vault key.\n\n' +
            whatUnlocksWhat(translations.value),
          okText: 'Close',
        });
        // enrollment offer: prompt to add passkey if missing
        if (accountStore.devices.length === 0) {
          dialog.confirm({
            title: 'Add a passkey?',
            body: 'You should add a passkey so you do not need the recovery code for daily sign-in.',
            okText: 'Add passkey',
            cancelText: 'Later',
            onConfirm: () => router.push('/settings'),
          });
        }
      } catch (e) {
        dialog.alert({
          title: 'Failed to generate',
          body: e?.message || 'Failed to generate the account recovery code.',
          okText: 'Close',
        });
      } finally {
        recoveryBusy.value = false;
      }
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

    // ?addAccount=1 asks for the sign-out form even while signed in, so the
    // switcher can add a second account without signing the first one out.
    const addingAccount = computed(() => route.query.addAccount === '1');

    const accounts = computed(() => listAccounts());
    const activeAccountId = computed(() => getActiveAccountId());
    // The current account already has its own row above, so the switcher
    // lists only the others — while signed out there is no profile row, so
    // every indexed account stays reachable.
    const visibleAccounts = computed(() =>
      accountStore.isAnonymous
        ? accounts.value
        : accounts.value.filter((acct) => acct.id !== activeAccountId.value),
    );

    // "This device" badge on the devices list (async — resolved in onMounted).
    const thisDeviceId = ref(null);
    onMounted(() => {
      getSyncDeviceId()
        .then((id) => {
          thisDeviceId.value = id;
        })
        .catch(() => {});
      // The device list is never pushed to the store, so pull it on open —
      // otherwise it stays empty until someone hits Refresh.
      if (accountStore.isAuthenticated) {
        getAccount({ baseUrl: accountStore.serverUrl })
          .then((data) => {
            if (data) accountStore.setDevices(data.devices || []);
          })
          .catch(() => {});
      }
    });

    // Plan row description: the plan label plus whatever limits the server sent.
    const planDescription = computed(() => {
      const limits = planLimitsText(accountStore.planLimits);
      return limits
        ? `${planLabel(accountStore.plan)} · ${limits}`
        : planLabel(accountStore.plan);
    });

    // Read the account record, not the store, so each row is right for its own
    // account rather than for whichever one happens to be active.
    function accountLabel(acct) {
      return acct?.label || acct?.email || 'Account';
    }
    function accountInitial(acct) {
      return accountLabel(acct).trim().charAt(0) || '?';
    }
    function accountPlan(acct) {
      const plan = acct?.subscription?.plan || acct?.planLimits?.plan;
      return typeof plan === 'string' ? plan : '';
    }

    async function selectAccount(accountId) {
      if (accountId === activeAccountId.value) return;
      await switchAccount({ accountId });
    }

    function promptSignOutAccount(acct) {
      dialog.confirm({
        title: 'Sign out?',
        body: `${accountLabel(acct)} stops syncing. Notes already on this device stay, and you can sign back in later.`,
        okText: 'Sign out',
        cancelText: 'Cancel',
        icon: 'riLogoutBoxRLine',
        onConfirm: () => signOutAccount(acct.id),
      });
    }

    function addAccount() {
      router.push({ path: '/settings/account', query: { addAccount: '1' } });
    }

    function cancelAddAccount() {
      router.push({ path: '/settings/account' });
    }

    const authView = ref('welcome'); // welcome | signin | create | forgot
    const method = ref(passkeysAvailable.value ? 'passkey' : 'password');

    const authTitle = computed(() => {
      const a = translations.value?.account || {};
      switch (authView.value) {
        case 'signin':
          return a.signIn || 'Welcome back';
        case 'create':
          return a.createAccount || 'Create your account';
        case 'forgot':
          return a.forgotPassword || 'Reset password';
        default:
          return a.signInHeading || 'Sign in to sync';
      }
    });
    const authSubtitle = computed(() => {
      const a = translations.value?.account || {};
      switch (authView.value) {
        case 'signin':
          return method.value === 'passkey'
            ? 'Use the passkey saved on this device.'
            : 'Enter your email and password.';
        case 'create':
          return method.value === 'passkey'
            ? 'No password needed. Email is optional.'
            : 'Choose an email and a strong password.';
        case 'forgot':
          return "We'll email you a reset link.";
        default:
          return (
            a.signInBody ||
            'Optional. Without an account, your notes stay on this device.'
          );
      }
    });

    function openView(view) {
      authView.value = view;
    }
    function openForgot() {
      forgotEmail.value = signInEmail.value || forgotEmail.value;
      authView.value = 'forgot';
    }
    function goBack() {
      authView.value = authView.value === 'forgot' ? 'signin' : 'welcome';
    }

    return {
      authView,
      method,
      authTitle,
      authSubtitle,
      openView,
      openForgot,
      goBack,
      translations,
      tr,
      whatUnlocks,
      fmt,
      PLAN_NAMES,
      planLabel,
      planLimitsText,
      planDescription,
      accountStore,
      passkeysAvailable,
      addingAccount,
      accounts,
      activeAccountId,
      visibleAccounts,
      thisDeviceId,
      accountLabel,
      accountInitial,
      accountPlan,
      selectAccount,
      promptSignOutAccount,
      addAccount,
      cancelAddAccount,
      seedPhaseLabel,
      seedProgressPercent,
      showVaultImportPrompt,
      passwordModalOpen,
      recoveryModalOpen,
      showAdvanced,
      storageWarningDismissed,
      emailBannerDismissed,
      displayName,
      goToSecurity,
      importVaultDialog,
      forgotEmail,
      forgotBusy,
      forgotMessage,
      forgotSent,
      handleForgot,
      changeCurrent,
      changeNew,
      changeConfirm,
      changeBusy,
      changeMessage,
      changeSuccess,
      handleChangePassword,
      recoveryCode,
      recoveryBusy,
      handleGenerateRecoveryCode,
      emailVerifySending,
      emailVerifyCooldown,
      handleRequestEmailVerification,
      billingBusy,
      billingError,
      billingMessage,
      billingSuccess,
      upgradeDescription,
      storageUsedPercent,
      storageNearLimit,
      openPaywall,
      devMode,
      unifiedDevices,
      platformIcon,
      platformLabel,
      fmtLastSeen,
      revokeUnified,
      refreshDevices,
      handleManageBilling,
      handleBillingReturn,
      isMobile,
      copyLogPath,
      logCopied,
      retrySeed,
      seedRetrying,
      ...account,
    };
  },
};
</script>

<style scoped>
.section-label {
  @apply mb-2.5 px-1 text-sm font-semibold text-neutral-600 dark:text-neutral-300;
}
</style>
