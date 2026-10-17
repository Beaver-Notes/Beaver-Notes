<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="mb-14 w-full max-w-xl space-y-6">
    <!-- ───────────── Accounts ───────────── -->
    <section v-if="accounts.length && !addingAccount" class="space-y-2">
      <h2 class="acct-heading">
        {{ translations.account?.accounts || 'Accounts' }}
      </h2>

      <ui-card padding="p-0">
        <div
          v-for="(acct, index) in accounts"
          :key="acct.id"
          class="acct-row flex items-center gap-3"
          :class="{ 'acct-divided': index > 0 }"
        >
          <button
            class="flex min-w-0 flex-1 items-center gap-3 text-left"
            :data-testid="
              acct.id === activeAccountId
                ? 'account-manager-active'
                : 'account-manager-option'
            "
            @click="selectAccount(acct.id)"
          >
            <span
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sm leading-none uppercase"
              :class="
                acct.id === activeAccountId
                  ? 'bg-primary/10 text-primary'
                  : 'bg-neutral-100 text-neutral-400 dark:bg-neutral-800'
              "
            >
              {{ accountInitial(acct) }}
            </span>
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
              <span class="acct-desc block truncate">
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
            class="shrink-0 text-xs font-medium text-neutral-500 transition-colors hover:text-red-500 dark:text-neutral-400 dark:hover:text-red-400"
            @click="promptSignOutAccount(acct)"
          >
            {{ translations.account?.signOut || 'Sign out' }}
          </button>
        </div>

        <div class="acct-row acct-divided">
          <button
            class="flex items-center gap-2 text-sm font-medium text-primary"
            @click="addAccount"
          >
            <v-remixicon name="riAddLine" size="16" />
            {{ translations.account?.addAccount || 'Add account' }}
          </button>
        </div>
      </ui-card>
    </section>

    <!-- ───────────── Signed out ───────────── -->
    <section
      v-if="accountStore.isAnonymous || addingAccount"
      class="space-y-2"
    >
      <h2 class="acct-heading">
        {{ translations.account?.title || 'Beaver Account' }}
      </h2>

      <ui-card padding="p-0">
        <!-- Intro -->
        <div class="acct-row flex items-start gap-4">
          <ui-beaver-character class="w-14 shrink-0" />
          <div class="min-w-0 flex-1">
            <p class="acct-title">
              {{
                translations.account?.signInHeading ||
                'Sign in to sync across devices.'
              }}
            </p>
            <p class="acct-desc">
              {{
                translations.account?.signInBody ||
                'A Beaver Account is optional. Without one, your notes stay on this device only.'
              }}
            </p>
          </div>
        </div>

        <!-- Passkey -->
        <div class="flex flex-col gap-2 px-4 pb-4">
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

        <!-- Password sign-in -->
        <div class="acct-divided px-4 py-3">
          <button
            type="button"
            class="acct-toggle"
            :aria-expanded="showPasswordAuth"
            @click="showPasswordAuth = !showPasswordAuth"
          >
            <span>{{
              translations.account?.withPassword || 'Or sign in with password'
            }}</span>
            <v-remixicon
              name="riArrowDownSLine"
              size="18"
              class="transition-transform"
              :class="{ 'rotate-180': showPasswordAuth }"
            />
          </button>
          <ui-expand-collapse
            :open="showPasswordAuth"
            max-open="max-h-[40rem]"
            :inert="showPasswordAuth ? null : true"
          >
            <div class="flex flex-col gap-2 p-1 pt-3">
              <ui-input
                v-model="signInEmail"
                type="email"
                prepend-icon="riMailLine"
                class="w-full"
                :placeholder="translations.account?.emailPlaceholder || 'Email'"
              />
              <ui-input
                v-model="signInPassword"
                :password="true"
                prepend-icon="riLockPasswordLine"
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

              <button
                class="mt-1 self-start text-xs text-primary hover:underline"
                type="button"
                @click="showForgot = !showForgot"
              >
                {{ tr.forgotPassword || 'Forgot password?' }}
              </button>
              <ui-card v-if="showForgot" padding="p-3" radius="rounded-xl">
                <div class="flex flex-col gap-2">
                  <ui-input
                    v-model="forgotEmail"
                    type="email"
                    :placeholder="tr.emailPlaceholder || 'Email for reset link'"
                    :aria-label="tr.emailPlaceholder || 'Email for reset link'"
                    class="w-full"
                  />
                  <ui-button
                    variant="secondary"
                    :loading="forgotBusy"
                    :aria-label="tr.sendResetLink || 'Send reset link'"
                    @click="handleForgot"
                  >
                    {{ tr.sendResetLink || 'Send reset link' }}
                  </ui-button>
                  <p
                    v-if="forgotMessage"
                    class="text-xs"
                    :class="forgotSent ? 'text-green-600' : 'text-amber-600'"
                  >
                    {{ forgotMessage }}
                  </p>
                  <p class="text-xs text-neutral-500">
                    {{
                      tr.inboxHint ||
                      'If an account exists for that email, you will receive a password reset link. Check your inbox (and spam folder).'
                    }}
                  </p>
                </div>
              </ui-card>
            </div>
          </ui-expand-collapse>
        </div>

        <!-- Quick connect -->
        <div class="acct-divided px-4 py-3">
          <button
            type="button"
            class="acct-toggle"
            :aria-expanded="showQuickConnect"
            @click="showQuickConnect = !showQuickConnect"
          >
            <span>{{
              translations.account?.quickConnect ||
              'Signing in from another device?'
            }}</span>
            <v-remixicon
              name="riArrowDownSLine"
              size="18"
              class="transition-transform"
              :class="{ 'rotate-180': showQuickConnect }"
            />
          </button>
          <ui-expand-collapse
            :open="showQuickConnect"
            max-open="max-h-[32rem]"
            :inert="showQuickConnect ? null : true"
          >
            <div class="space-y-2 p-1 pt-3">
              <p class="acct-desc">
                {{
                  translations.account?.quickConnectBody ||
                  'Approve a code on another device that is already signed in.'
                }}
              </p>
              <ui-button
                v-if="!quickConnectSecret"
                class="w-full"
                variant="secondary"
                :loading="accountStore.busy"
                :disabled="accountStore.busy"
                @click="startQuickConnect"
              >
                <v-remixicon name="riQrCodeLine" class="mr-1" />
                {{ translations.account?.quickConnectStart || 'Start' }}
              </ui-button>
              <template v-else>
                <ui-card
                  padding="px-3 py-2"
                  radius="rounded-xl"
                  class="text-center font-mono text-lg dark:text-neutral-200"
                >
                  {{
                    translations.account?.quickConnectHint ||
                    'Enter this code on your other device, or paste a code from another device here.'
                  }}
                </ui-card>
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
                      translations.account?.quickConnectCheck ||
                      'Check approval'
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
              </template>
            </div>
          </ui-expand-collapse>
        </div>

        <div v-if="accountStore.error" class="acct-divided px-4 py-3">
          <p class="text-sm text-red-500" role="alert">
            {{ accountStore.error }}
          </p>
        </div>

        <div v-if="addingAccount" class="acct-divided px-4 py-3">
          <ui-button @click="cancelAddAccount">
            {{ translations.account?.cancel || 'Cancel' }}
          </ui-button>
        </div>
      </ui-card>
    </section>

    <!-- ───────────── Signed in ───────────── -->
    <section v-else class="space-y-2">
      <h2 class="acct-heading">
        {{ translations.account?.title || 'Beaver Account' }}
      </h2>

      <ui-card padding="p-0">
        <!-- Profile -->
        <div class="acct-row flex items-center gap-3">
          <ui-user-avatar :name="displayName" :size="40" />
          <div class="min-w-0 flex-1">
            <p class="acct-title flex items-center gap-2">
              <span class="truncate">{{
                accountStore.profile?.email ||
                accountStore.profile?.username ||
                translations.account?.signedInAs ||
                'Signed in'
              }}</span>
              <span
                v-if="accountStore.profile?.emailVerified === true"
                class="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-green-100 px-1.5 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-300"
              >
                <v-remixicon name="riCheckLine" size="12" />
                {{ tr.verified || 'Verified' }}
              </span>
              <span
                v-else-if="accountStore.profile?.emailVerified === false"
                class="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
              >
                {{ tr.unverified || 'Unverified' }}
              </span>
            </p>
            <p class="acct-desc truncate">{{ accountStore.serverUrl }}</p>
          </div>
          <ui-button variant="danger" @click="handleSignOut">
            <v-remixicon name="riLogoutBoxRLine" class="mr-1" />
            {{ translations.account?.signOut || 'Sign out' }}
          </ui-button>
        </div>

        <!-- Email verification -->
        <div
          v-if="accountStore.profile?.emailVerified === false"
          class="acct-row acct-divided flex items-center justify-between gap-3"
        >
          <div class="min-w-0 flex-1">
            <p class="acct-title">
              {{ tr.emailVerification || 'Email verification' }}
            </p>
            <p class="acct-desc">
              {{
                tr.verifyToInvite ||
                'Verify your email to invite collaborators.'
              }}
            </p>
          </div>
          <ui-button
            variant="secondary"
            :loading="emailVerifySending"
            :disabled="emailVerifySending || emailVerifyCooldown > 0"
            :aria-label="
              emailVerifyCooldown > 0
                ? fmt('resendWithCooldown', { seconds: emailVerifyCooldown }) ||
                  `Resend (${emailVerifyCooldown}s)`
                : tr.verifyEmail || 'Verify email'
            "
            @click="handleRequestEmailVerification"
          >
            {{
              emailVerifyCooldown > 0
                ? fmt('resendWithCooldown', { seconds: emailVerifyCooldown }) ||
                  `Resend (${emailVerifyCooldown}s)`
                : tr.verifyEmail || 'Verify email'
            }}
          </ui-button>
        </div>

        <!-- Username -->
        <div class="acct-row acct-divided">
          <div
            v-if="!editingUsername"
            class="flex items-center justify-between gap-3"
          >
            <div class="min-w-0">
              <p class="acct-title">
                {{ translations.account?.username || 'Username' }}
              </p>
              <p class="acct-desc truncate">
                {{
                  accountStore.profile?.username ||
                  accountStore.profile?.email ||
                  'Not set'
                }}
              </p>
            </div>
            <ui-button variant="secondary" @click="startEditUsername">
              {{ translations.settings?.change || 'Change' }}
            </ui-button>
          </div>
          <div v-else class="flex flex-col gap-2">
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
        </div>

        <!-- Member since -->
        <div
          v-if="accountStore.profile?.createdAt"
          class="acct-row acct-divided"
        >
          <p class="acct-title">
            {{ translations.account?.memberSince || 'Member since' }}
          </p>
          <p class="acct-desc">
            {{ new Date(accountStore.profile.createdAt).toLocaleDateString() }}
          </p>
        </div>

        <!-- Sync status -->
        <div class="beaver-sync-ready">
          <div
            v-if="accountStore.seedStatus === 'seeding'"
            class="acct-row acct-divided space-y-3"
          >
            <div class="flex items-center gap-3">
              <ui-spinner size="18" />
              <p class="acct-title">{{ seedPhaseLabel }}</p>
            </div>
            <div class="space-y-2">
              <div
                class="flex justify-between text-xs text-neutral-600 dark:text-neutral-400"
              >
                <span>{{ seedPhaseLabel }}</span>
                <span
                  >{{ accountStore.seedProgress.uploaded }} /
                  {{ accountStore.seedProgress.total }}</span
                >
              </div>
              <div
                class="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700"
                role="progressbar"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-valuenow="seedProgressPercent"
              >
                <div
                  class="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                  :style="{ width: seedProgressPercent + '%' }"
                ></div>
              </div>
            </div>
          </div>

          <div
            v-else-if="accountStore.seedStatus === 'done'"
            class="acct-row acct-divided flex items-center gap-2"
          >
            <v-remixicon
              name="riCheckLine"
              class="text-green-600 dark:text-green-400"
              size="18"
            />
            <p class="text-sm font-medium text-green-700 dark:text-green-300">
              {{ tr.cloudSyncReady || 'Cloud sync ready' }}
            </p>
          </div>

          <!-- Vault import prompt for existing apps -->
          <div
            v-if="showVaultImportPrompt"
            class="acct-row acct-divided space-y-2"
          >
            <div>
              <p class="acct-title">
                {{ translations.account?.vaultDetected || 'Vault detected' }}
              </p>
              <p class="acct-desc">
                {{
                  translations.account?.vaultDetectedBody ||
                  'A vault was found in your sync source. Import it to unlock your notes.'
                }}
              </p>
            </div>
            <ui-banner
              icon="riShieldKeyholeLine"
              :content="translations.account?.vaultDetected || 'Vault detected'"
              :primary-text="translations.account?.importVault || 'Import'"
              :secondary-text="translations.dialog?.close || 'Later'"
              @button-1="importVaultDialog"
              @button-2="showVaultImportPrompt = false"
            />
          </div>

          <div
            v-else-if="accountStore.seedStatus === 'error'"
            class="acct-row acct-divided space-y-2"
          >
            <div class="flex items-center gap-2">
              <v-remixicon
                name="riErrorWarningLine"
                class="shrink-0 text-red-600 dark:text-red-400"
                size="18"
              />
              <p class="text-sm font-medium text-red-700 dark:text-red-300">
                {{
                  accountStore.seedError ||
                  tr.syncSetupFailed ||
                  'Sync setup failed'
                }}
              </p>
            </div>
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
        </div>

        <!-- Plan -->
        <div class="acct-row acct-divided flex items-center gap-3">
          <div class="min-w-0 flex-1">
            <p class="acct-title">
              {{ translations.account?.plan || 'Plan' }}
            </p>
            <p class="acct-desc">
              {{
                planLabel(accountStore.plan) ||
                translations.account?.noPlan ||
                'No plan'
              }}
            </p>
            <p v-if="planLimitsText(accountStore.planLimits)" class="acct-desc">
              {{ planLimitsText(accountStore.planLimits) }}
            </p>
            <p v-if="accountStore.isPaidPlan" class="acct-desc">
              {{
                tr.manageBillingDescription ||
                'Manage payment method, invoices, or cancel.'
              }}
            </p>
          </div>
          <ui-button
            v-if="accountStore.isPaidPlan"
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
          <span v-else class="text-xs text-neutral-400">{{
            tr.free || 'Free'
          }}</span>
        </div>

        <!-- Billing feedback -->
        <div v-if="billingMessage" class="acct-divided px-4 py-2">
          <p
            class="text-xs"
            :class="billingSuccess ? 'text-green-600' : 'text-amber-600'"
          >
            {{ billingMessage }}
          </p>
        </div>

        <!-- Upgrade -->
        <div
          v-if="
            !accountStore.isPaidPlan || accountStore.plan === PLAN_NAMES.STARTER
          "
          class="acct-row acct-divided"
        >
          <p class="acct-title">{{ tr.upgrade || 'Upgrade' }}</p>
          <p class="acct-desc">
            {{
              tr.upgradeDescription ||
              'Choose a plan. Checkout opens in your browser (subscription activates via webhook).'
            }}
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <template v-for="opt in billingOptions" :key="opt.key">
              <ui-button
                v-if="!isMobile || opt.plan !== 'team'"
                size="sm"
                :variant="
                  opt.plan === accountStore.plan ? 'secondary' : 'primary'
                "
                :loading="billingBusy"
                :disabled="billingBusy || opt.plan === accountStore.plan"
                @click="handleCheckout(opt.plan, opt.interval)"
              >
                {{ opt.label }}
              </ui-button>
            </template>
          </div>
          <p v-if="billingError" class="mt-2 text-xs text-red-500">
            {{ billingError }}
          </p>
        </div>

        <!-- Storage -->
        <div
          v-if="
            accountStore.subscription?.storage &&
            accountStore.plan !== PLAN_NAMES.ENTERPRISE
          "
          class="acct-row acct-divided"
        >
          <div class="flex items-center justify-between">
            <p class="acct-title">
              {{ translations.account?.storage || 'Storage' }}
            </p>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">
              {{
                (
                  accountStore.subscription.storage.usedBytes / 1073741824
                ).toFixed(1)
              }}
              /
              {{
                (
                  accountStore.subscription.storage.quotaBytes / 1073741824
                ).toFixed(0)
              }}
              GB
            </p>
          </div>
          <div
            class="mt-2 h-1.5 overflow-hidden rounded-full bg-primary/20"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="Math.round(Math.min(100, storageUsedPercent))"
          >
            <div
              class="h-full rounded-full bg-primary transition-all duration-200"
              :class="{ '!bg-amber-500': storageNearLimit }"
              :style="{ width: `${Math.min(100, storageUsedPercent)}%` }"
            />
          </div>
          <div
            v-if="storageNearLimit && !storageWarningDismissed"
            data-testid="storage-quota-warning"
            class="mt-3 space-y-2"
          >
            <p class="text-xs text-amber-800 dark:text-amber-200">
              {{
                tr.storageWarning ||
                'You are close to your storage limit. Upgrade for more space.'
              }}
            </p>
            <ui-banner
              icon="riErrorWarningLine"
              :content="tr.storageWarning || 'Storage almost full'"
              :primary-text="tr.upgrade || 'Upgrade'"
              :secondary-text="translations.dialog?.close || 'Dismiss'"
              @button-1="openUpgrade"
              @button-2="storageWarningDismissed = true"
            />
          </div>
        </div>

        <!-- Cloud sync CTA -->
        <div class="beaver-sync-ready">
          <div v-if="!accountStore.isPaidPlan" class="acct-row acct-divided">
            <p class="acct-title">
              {{
                translations.account?.cloudSyncCtaHeading ||
                `Cloud sync is part of ${planLabel(PLAN_NAMES.STARTER)}.`
              }}
            </p>
            <p class="acct-desc">
              {{
                translations.account?.cloudSyncCtaBody ||
                `Upgrade to ${planLabel(PLAN_NAMES.STARTER)} or higher to sync notes across devices through Beaver Sync. Your current folder sync keeps working in the meantime.`
              }}
            </p>
          </div>
        </div>
      </ui-card>

      <subscription-dialog
        v-model="showPlansDialog"
        :products="iap.products.value"
        :loading="iap.loading.value"
        :error="iap.error.value"
        :busy="iapBusy"
        :interval="plansInterval"
        :is-paid="accountStore.isPaidPlan"
        :current-plan="accountStore.plan"
        :signed-in="accountStore.isAuthenticated"
        @update:interval="plansInterval = $event"
        @select="handleIapSelect"
        @restore="handleIapRestore"
      />
    </section>

    <!-- ───────────── Security (collapsible) ───────────── -->
    <section v-if="accountStore.isAuthenticated" class="space-y-2">
      <button
        type="button"
        class="acct-toggle"
        :aria-expanded="showSecurity"
        @click="showSecurity = !showSecurity"
      >
        <span class="acct-heading !px-0">{{
          translations.account?.security || 'Security'
        }}</span>
        <v-remixicon
          name="riArrowDownSLine"
          size="18"
          class="transition-transform"
          :class="{ 'rotate-180': showSecurity }"
        />
      </button>

      <ui-expand-collapse
        :open="showSecurity"
        max-open="max-h-[120rem]"
        :inert="showSecurity ? null : true"
      >
        <div class="space-y-4 p-1">
          <!-- Devices -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <p class="acct-heading">
                {{ translations.account?.devices || 'Your devices' }}
              </p>
              <ui-button variant="secondary" size="sm" @click="loadSessions">
                <v-remixicon name="riRefreshLine" size="14" class="mr-1" />
                {{ translations.settings?.syncNow || 'Refresh' }}
              </ui-button>
            </div>
            <ui-card padding="p-0">
              <ui-list class="space-y-0.5 p-1.5">
                <div
                  v-if="loadingSessions && !unifiedDevices.length"
                  class="flex justify-center py-6"
                >
                  <ui-spinner size="20" color="text-neutral-400" />
                </div>
                <p
                  v-else-if="!unifiedDevices.length"
                  class="acct-desc px-2 py-2"
                >
                  {{ translations.account?.noSessions || 'No active devices' }}
                </p>
                <ui-list-item
                  v-for="entry in unifiedDevices"
                  :key="entry.key"
                  class="gap-3"
                >
                  <div
                    class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800"
                  >
                    <v-remixicon :name="platformIcon(entry.platform)" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="acct-title truncate">{{ entry.name }}</p>
                    <p class="acct-desc truncate" :title="entry.id || ''">
                      {{ platformLabel(entry.platform) }}
                      <template v-if="entry.lastSeen">
                        · {{ fmtLastSeen(entry.lastSeen) }}
                      </template>
                    </p>
                  </div>
                  <ui-button
                    icon
                    variant="danger"
                    size="sm"
                    :aria-label="
                      translations.account?.revokeDevice || 'Revoke device'
                    "
                    @click="revokeUnified(entry)"
                  >
                    <v-remixicon name="riDeleteBin6Line" />
                  </ui-button>
                </ui-list-item>
              </ui-list>
            </ui-card>
          </div>

          <!-- Sign out everywhere / password / recovery -->
          <ui-card padding="p-0">
            <div class="acct-row flex items-center gap-3">
              <div class="min-w-0 flex-1">
                <p class="acct-title">
                  {{
                    translations.account?.signOutEverywhereTitle ||
                    'Sign out everywhere'
                  }}
                </p>
                <p class="acct-desc">
                  {{
                    translations.account?.signOutEverywhereBody ||
                    'Revoke all other devices. This device stays signed in.'
                  }}
                </p>
              </div>
              <ui-button variant="danger" @click="handleSignOutEverywhere">
                {{
                  translations.account?.signOutEverywhere ||
                  'Sign out everywhere'
                }}
              </ui-button>
            </div>

            <!-- Change password -->
            <div class="acct-row acct-divided">
              <p class="acct-title">
                {{ tr.changePassword || 'Change password' }}
              </p>
              <p class="acct-desc">
                {{
                  tr.changePasswordDescription ||
                  'Verifies current password, rotates, revokes other sessions.'
                }}
              </p>
              <div class="mt-3 flex flex-col gap-2">
                <ui-input
                  v-model="changeCurrent"
                  :password="true"
                  prepend-icon="riLockPasswordLine"
                  :placeholder="
                    tr.currentPasswordPlaceholder || 'Current password'
                  "
                  :aria-label="
                    tr.currentPasswordPlaceholder || 'Current password'
                  "
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
                <p
                  v-if="changeMessage"
                  class="text-xs"
                  :class="changeSuccess ? 'text-green-600' : 'text-red-500'"
                  role="status"
                >
                  {{ changeMessage }}
                </p>
                <ui-button
                  variant="secondary"
                  :loading="changeBusy"
                  :aria-label="tr.changePassword || 'Change password'"
                  @click="handleChangePassword"
                >
                  {{ tr.changePassword || 'Change password' }}
                </ui-button>
              </div>
            </div>

            <!-- Recovery code -->
            <div class="acct-row acct-divided">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <p class="acct-title">
                    {{ tr.recoveryCode || 'Account recovery code' }}
                  </p>
                  <p class="acct-desc">
                    {{
                      tr.recoveryCodeDescription ||
                      'Restores account sign-in if you lose your passkeys. Regenerating invalidates the old code. It does not unlock your notes.'
                    }}
                  </p>
                  <p class="acct-desc whitespace-pre-line">
                    {{ whatUnlocks }}
                  </p>
                </div>
                <ui-button
                  variant="secondary"
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
              </div>
              <ui-card
                v-if="recoveryCode"
                bg="bg-amber-50 dark:bg-amber-900/20"
                radius="rounded-xl"
                padding="px-3 py-2"
                class="mt-3 border-amber-200 dark:border-amber-800"
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
          </ui-card>
        </div>
      </ui-expand-collapse>
    </section>

    <!-- ───────────── Privacy ───────────── -->
    <section v-if="accountStore.isAuthenticated" class="space-y-2">
      <h2 class="acct-heading">
        {{ translations.account?.privacy || 'Privacy' }}
      </h2>
      <ui-card padding="p-0">
        <div class="acct-row flex items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="acct-title">
              {{ translations.account?.exportData || 'Export account data' }}
            </p>
            <p class="acct-desc">
              {{
                translations.account?.exportDataBody ||
                'Download a copy of your account information.'
              }}
            </p>
          </div>
          <ui-button variant="secondary" @click="exportAccountData">
            <v-remixicon name="riDownloadLine" class="mr-1" />
            {{ translations.account?.export || 'Export' }}
          </ui-button>
        </div>
      </ui-card>
    </section>

    <!-- ───────────── Advanced (collapsible) ───────────── -->
    <section class="beaver-sync-ready space-y-2">
      <button
        type="button"
        class="acct-toggle"
        :aria-expanded="showAdvanced"
        @click="showAdvanced = !showAdvanced"
      >
        <span class="acct-heading !px-0">{{
          translations.account?.advanced || 'Advanced'
        }}</span>
        <v-remixicon
          name="riArrowDownSLine"
          size="18"
          class="transition-transform"
          :class="{ 'rotate-180': showAdvanced }"
        />
      </button>
      <ui-expand-collapse
        :open="showAdvanced"
        max-open="max-h-80"
        :inert="showAdvanced ? null : true"
      >
        <div class="p-1">
          <ui-card padding="p-0">
            <div
              v-if="!showServerUrlEditor"
              class="acct-row flex items-center gap-3"
            >
              <div class="min-w-0 flex-1">
                <p class="acct-title truncate font-mono">
                  {{ accountStore.serverUrl }}
                </p>
                <p class="acct-desc">
                  {{
                    translations.account?.serverHint ||
                    'Change this to point at a self-hosted Beaver Sync instance.'
                  }}
                </p>
              </div>
              <ui-button @click="showServerUrlEditor = true">
                {{ translations.settings?.change || 'Change' }}
              </ui-button>
            </div>
            <div v-else class="acct-row flex flex-col gap-2">
              <ui-input
                v-model="draftServerUrl"
                class="w-full"
                prepend-icon="riServerLine"
                :placeholder="defaultServerUrl"
              />
              <div class="flex flex-wrap justify-end gap-2">
                <ui-button @click="showServerUrlEditor = false">{{
                  translations.dialog?.cancel || 'Cancel'
                }}</ui-button>
                <ui-button variant="secondary" @click="resetServerUrl">{{
                  translations.account?.useDefault || 'Use default'
                }}</ui-button>
                <ui-button
                  variant="primary"
                  :loading="accountStore.busy"
                  @click="saveServerUrl"
                  >{{ translations.settings?.enable || 'Save' }}</ui-button
                >
              </div>
            </div>
          </ui-card>
        </div>
      </ui-expand-collapse>
    </section>

    <!-- ───────────── Danger zone ───────────── -->
    <section v-if="accountStore.isAuthenticated" class="space-y-2">
      <h2 class="acct-heading !text-red-500 dark:!text-red-400">
        {{ translations.account?.dangerZone || 'Danger zone' }}
      </h2>
      <ui-card
        bg="bg-red-50/80 dark:bg-red-950/30"
        padding="px-4 py-3.5"
        class="flex flex-col gap-3 border-red-200 dark:border-red-900/70"
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
            <v-remixicon name="riDeleteBin6Line" class="mr-1" />
            {{ translations.account?.deleteAccount || 'Delete account' }}
          </ui-button>
        </div>
        <div v-else class="flex flex-col gap-2">
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
      </ui-card>
    </section>
  </div>
</template>

<script>
import { computed, ref, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDialog } from '@/lib/dialog';
import { useTranslations } from '@/composable/useTranslations';
import { useSettingsAccount } from '@/composable/useSettingsAccount';
import {
  signOutAccount,
  switchAccount,
} from '@/composable/useAccountAuth';
import { getActiveAccountId, listAccounts } from '@/lib/accounts-index';
import { useAccountStore } from '@/store/account';
import { PLAN_NAMES, planLabel, planLimitsText } from '@/lib/api/types';
import {
  generateRecoveryCode as apiGenerateRecoveryCode,
  requestEmailVerification as apiRequestEmailVerification,
  changePassword as apiChangePassword,
} from '@/lib/api/account';
import { createCheckoutSession, createPortalSession } from '@/lib/api/billing';
import { isMobileRuntime } from '@/lib/tauri/runtime';
import { localNoteCount } from '@/utils/notes/local-note-count.js';
import { deviceDisplayName, devicePlatform } from '@/utils/device/device-label';
import { whatUnlocksWhat } from '@/utils/i18n/secrets.js';
import SubscriptionDialog from '@/components/billing/SubscriptionDialog.vue';
import { useIapBilling } from '@/composable/useIapBilling';

export default {
  components: { SubscriptionDialog },
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

    // One list for "your devices": registered devices plus active sessions,
    // de-duplicated by device id. The raw id is only a tooltip; the visible
    // label is always human (platform + last seen).
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
    const showSecurity = ref(false);
    const showAdvanced = ref(false);
    const storageWarningDismissed = ref(false);
    const displayName = computed(
      () => accountStore.profile?.username || accountStore.profile?.email || '',
    );
    const showForgot = ref(false);
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
    const iap = useIapBilling({ accountStore });
    const showPlansDialog = ref(false);
    const plansInterval = ref('monthly');
    const iapBusy = ref(false);
    async function handleIapSelect(plan, interval) {
      iapBusy.value = true;
      billingError.value = '';
      billingMessage.value = '';
      try {
        const result = await iap.buy(plan, interval);
        if (result) {
          showPlansDialog.value = false;
          billingMessage.value = `Subscribed to ${result}. Your plan is now active.`;
          billingSuccess.value = true;
        } else {
          billingMessage.value =
            'Payment processing — your plan will activate shortly';
          billingSuccess.value = false;
        }
      } catch (e) {
        const msg = e?.message || 'Purchase failed.';
        billingError.value = msg;
        billingSuccess.value = false;
        dialog.alert({ title: 'Purchase failed', body: msg, okText: 'Close' });
      } finally {
        iapBusy.value = false;
      }
    }
    async function handleIapRestore() {
      iapBusy.value = true;
      billingError.value = '';
      billingMessage.value = '';
      try {
        await iap.restore();
        if (accountStore.isPaidPlan) {
          showPlansDialog.value = false;
          billingMessage.value = 'Purchases restored. Your plan is now active.';
          billingSuccess.value = true;
        } else {
          billingMessage.value = 'No purchases found for this account.';
          billingSuccess.value = false;
        }
      } catch (e) {
        const msg = e?.message || 'Restore failed.';
        billingError.value = msg;
        billingSuccess.value = false;
        dialog.alert({ title: 'Restore failed', body: msg, okText: 'Close' });
      } finally {
        iapBusy.value = false;
      }
    }
    const billingOptions = [
      { key: 'starter-monthly', plan: PLAN_NAMES.STARTER, interval: 'monthly' },
      { key: 'starter-yearly', plan: PLAN_NAMES.STARTER, interval: 'yearly' },
      { key: 'pro-monthly', plan: PLAN_NAMES.PRO, interval: 'monthly' },
      { key: 'pro-yearly', plan: PLAN_NAMES.PRO, interval: 'yearly' },
      { key: 'team-monthly', plan: PLAN_NAMES.TEAM, interval: 'monthly' },
      { key: 'team-yearly', plan: PLAN_NAMES.TEAM, interval: 'yearly' },
    ].map((opt) => ({
      ...opt,
      label: `${planLabel(opt.plan)} ${opt.interval === 'monthly' ? 'Monthly' : 'Yearly'}`,
    }));
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
    function openUpgrade() {
      const ladder = [
        PLAN_NAMES.STARTER,
        PLAN_NAMES.PRO,
        PLAN_NAMES.TEAM,
        PLAN_NAMES.ENTERPRISE,
      ];
      const idx = ladder.indexOf(accountStore.plan);
      handleCheckout(ladder[Math.min(idx + 1, ladder.length - 1)], 'monthly');
    }

    // Server-supplied billing URLs are untrusted input: only open https links
    // on Stripe checkout/portal hosts or the configured sync server itself.
    const BILLING_HOSTS = new Set([
      'checkout.stripe.com',
      'billing.stripe.com',
      'js.stripe.com',
    ]);
    function isAllowedBillingUrl(url) {
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        return false;
      }
      if (parsed.protocol !== 'https:') return false;
      if (BILLING_HOSTS.has(parsed.hostname)) return true;
      try {
        return parsed.hostname === new URL(accountStore.serverUrl).hostname;
      } catch {
        return false;
      }
    }
    async function openBillingUrl(url) {
      billingError.value = '';
      if (!url) return;
      if (!isAllowedBillingUrl(url)) {
        billingError.value = 'Refusing to open an unexpected billing URL.';
        return;
      }
      try {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(url);
      } catch {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    }
    async function handleCheckout(plan, interval) {
      if (isMobile) {
        plansInterval.value = interval;
        if (!iap.products.value.length && !iap.loading.value)
          await iap.loadProducts();
        showPlansDialog.value = true;
        return;
      }
      billingBusy.value = true;
      billingError.value = '';
      billingMessage.value = '';
      try {
        const res = await createCheckoutSession(plan, interval, {
          baseUrl: accountStore.serverUrl,
        });
        const url = res?.url;
        if (url) await openBillingUrl(url);
        else throw new Error('No checkout URL returned');
        billingMessage.value =
          'Checkout opened in browser. Complete payment there; subscription activates shortly via webhook.';
        billingSuccess.value = true;
      } catch (e) {
        const msg =
          e?.body?.error === 'EMAIL_NOT_VERIFIED'
            ? 'Please verify your email before upgrading.'
            : e?.message || 'Failed to start checkout.';
        billingError.value = msg;
        dialog.alert({ title: 'Checkout failed', body: msg, okText: 'Close' });
      } finally {
        billingBusy.value = false;
      }
    }
    async function handleManageBilling() {
      if (isMobile) {
        await iap.openManage();
        return;
      }
      billingBusy.value = true;
      billingError.value = '';
      try {
        const res = await createPortalSession({
          baseUrl: accountStore.serverUrl,
        });
        const url = res?.url;
        if (url) await openBillingUrl(url);
        else throw new Error('No portal URL returned');
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
      // Deep link from the Team settings upgrade gate: open checkout with the
      // requested plan already chosen.
      const requestedPlan = route.query?.upgrade;
      if (
        typeof requestedPlan === 'string' &&
        Object.values(PLAN_NAMES).includes(requestedPlan)
      ) {
        handleCheckout(requestedPlan, 'monthly');
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

    return {
      translations,
      tr,
      whatUnlocks,
      fmt,
      PLAN_NAMES,
      planLabel,
      planLimitsText,
      accountStore,
      addingAccount,
      accounts,
      activeAccountId,
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
      showSecurity,
      showAdvanced,
      storageWarningDismissed,
      displayName,
      goToSecurity,
      importVaultDialog,
      showForgot,
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
      billingOptions,
      storageUsedPercent,
      storageNearLimit,
      openUpgrade,
      unifiedDevices,
      platformIcon,
      platformLabel,
      fmtLastSeen,
      revokeUnified,
      handleCheckout,
      handleManageBilling,
      handleBillingReturn,
      isMobile,
      showPlansDialog,
      plansInterval,
      iap,
      iapBusy,
      handleIapSelect,
      handleIapRestore,
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
.acct-heading {
  @apply px-1 text-sm font-semibold text-neutral-600 dark:text-neutral-300;
}
.acct-title {
  @apply text-sm font-medium text-neutral-800 dark:text-neutral-200;
}
.acct-desc {
  @apply mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400;
}
.acct-row {
  @apply px-4 py-3.5;
}
.acct-divided {
  @apply border-t border-neutral-200 dark:border-neutral-700;
}
.acct-toggle {
  @apply flex w-full cursor-pointer select-none items-center justify-between gap-2 rounded-lg text-left text-xs font-semibold tracking-wide text-neutral-500 transition-colors hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 ring-secondary dark:text-neutral-400 dark:hover:text-neutral-200;
}
</style>
