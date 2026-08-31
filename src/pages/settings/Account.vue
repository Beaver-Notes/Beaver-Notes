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
              :password="true"
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
            <button class="mt-2 text-xs text-primary hover:underline" type="button" @click="showForgot = !showForgot">{{ tr.forgotPassword || 'Forgot password?' }}</button>
            <div v-if="showForgot" class="mt-2 flex flex-col gap-2 border rounded-lg p-3 bg-neutral-50 dark:bg-neutral-800">
              <ui-input v-model="forgotEmail" type="email" :placeholder="tr.emailPlaceholder || 'Email for reset link'" :aria-label="tr.emailPlaceholder || 'Email for reset link'" class="w-full" />
              <ui-button variant="secondary" :loading="forgotBusy" :aria-label="tr.sendResetLink || 'Send reset link'" @click="handleForgot">{{ tr.sendResetLink || 'Send reset link' }}</ui-button>
              <p v-if="forgotMessage" class="text-xs" :class="forgotSent ? 'text-green-600' : 'text-amber-600'">{{ forgotMessage }}</p>
              <p class="text-xs text-neutral-500">{{ tr.inboxHint || 'If an account exists for that email, you will receive a password reset link. Check your inbox (and spam folder).' }}</p>
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
              class="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate flex items-center gap-2"
            >
              <span>{{
                accountStore.profile?.email ||
                accountStore.profile?.username ||
                translations.account?.signedInAs ||
                'Signed in'
              }}</span>
              <span
                v-if="accountStore.profile?.emailVerified === true"
                class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
              >{{ tr.verified || 'Verified' }}</span>
              <span
                v-else-if="accountStore.profile?.emailVerified === false"
                class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
              >{{ tr.unverified || 'Unverified' }}</span>
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
        <!-- Email verification -->
        <div
          v-if="accountStore.profile?.emailVerified === false"
          class="border-t border-neutral-200 dark:border-neutral-700 px-4 py-3.5 flex items-center justify-between gap-3"
        >
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">{{ tr.emailVerification || 'Email verification' }}</p>
            <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              {{ tr.verifyToInvite || 'Verify your email to invite collaborators.' }}
            </p>
          </div>
          <ui-button
            variant="secondary"
            :loading="emailVerifySending"
            :disabled="emailVerifySending || emailVerifyCooldown > 0"
            :aria-label="emailVerifyCooldown > 0 ? (fmt('resendWithCooldown', { seconds: emailVerifyCooldown }) || `Resend (${emailVerifyCooldown}s)`) : (tr.verifyEmail || 'Verify email')"
            @click="handleRequestEmailVerification"
          >
            {{ emailVerifyCooldown > 0 ? (fmt('resendWithCooldown', { seconds: emailVerifyCooldown }) || `Resend (${emailVerifyCooldown}s)`) : (tr.verifyEmail || 'Verify email') }}
          </ui-button>
        </div>

        <!-- Username -->
        <div
          class="border-t border-neutral-200 dark:border-neutral-700 px-4 py-3.5"
        >
          <div v-if="!editingUsername" class="flex items-center justify-between gap-3">
            <div>
              <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                {{ translations.account?.username || 'Username' }}
              </p>
              <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                {{ accountStore.profile?.username || 'Not set' }}
              </p>
            </div>
            <ui-button variant="secondary" @click="startEditUsername">
              {{ translations.settings?.changePassword || 'Change' }}
            </ui-button>
          </div>
          <div v-else class="flex flex-col gap-2">
            <ui-input
              v-model="draftUsername"
              class="w-full"
              placeholder="Username"
              @keyup.enter="saveUsername"
            />
            <div class="flex gap-2 justify-end">
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

        <!-- Account created -->
        <div
          v-if="accountStore.profile?.createdAt"
          class="border-t border-neutral-200 dark:border-neutral-700 px-4 py-3.5"
        >
          <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">
            {{ translations.account?.memberSince || 'Member since' }}
          </p>
          <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            {{ new Date(accountStore.profile.createdAt).toLocaleDateString() }}
          </p>
        </div>

        <!-- Seeding Progress -->
        <div class="beaver-sync-ready">
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
              {{ tr.cloudSyncReady || 'Cloud sync ready' }}
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
              {{ tr.syncSetupFailed || 'Sync setup failed' }}
            </p>
          </div>
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
          <ui-button
            v-if="accountStore.isPaidPlan"
            :loading="billingBusy"
            :disabled="billingBusy"
            :aria-label="tr.manageBilling || 'Manage billing'"
            @click="handleManageBilling"
          >
            <v-remixicon name="riExternalLinkLine" class="mr-1" />
            {{ tr.manageBilling || translations.account?.managePlan || 'Manage billing' }}
          </ui-button>
          <span v-else class="text-xs text-neutral-400">{{ tr.free || 'Free' }}</span>
        </div>

        <!-- Billing: upgrade / manage -->
        <div
          v-if="billingMessage"
          class="border-t border-neutral-200 dark:border-neutral-700 px-4 py-2"
        >
          <p class="text-xs" :class="billingSuccess ? 'text-green-600' : 'text-amber-600'">{{ billingMessage }}</p>
        </div>
        <div
          v-if="!accountStore.isPaidPlan || accountStore.plan === PLAN_NAMES.STARTER"
          class="border-t border-neutral-200 dark:border-neutral-700 px-4 py-3.5"
        >
          <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">{{ tr.upgrade || 'Upgrade' }}</p>
          <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{{ tr.upgradeDescription || 'Choose a plan. Checkout opens in your browser (subscription activates via webhook).' }}</p>
          <div class="mt-3 flex flex-wrap gap-2">
            <ui-button
              v-for="opt in billingOptions"
              :key="opt.key"
              size="sm"
              :variant="opt.plan === accountStore.plan ? 'secondary' : 'primary'"
              :loading="billingBusy"
              :disabled="billingBusy || opt.plan === accountStore.plan"
              @click="handleCheckout(opt.plan, opt.interval)"
            >
              {{ opt.label }}
            </ui-button>
              <ui-button
              v-if="accountStore.isPaidPlan"
              size="sm"
              variant="secondary"
              :loading="billingBusy"
              :disabled="billingBusy"
              :aria-label="tr.manageBilling || 'Manage billing'"
              @click="handleManageBilling"
            >
              {{ tr.manageBilling || 'Manage billing' }}
            </ui-button>
          </div>
          <p v-if="billingError" class="mt-2 text-xs text-red-500">{{ billingError }}</p>
        </div>
        <div
          v-else-if="accountStore.isPaidPlan"
          class="border-t border-neutral-200 dark:border-neutral-700 px-4 py-3.5 flex items-center justify-between gap-3"
        >
          <div>
            <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">{{ tr.billing || 'Billing' }}</p>
            <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{{ tr.manageBillingDescription || 'Manage payment method, invoices, or cancel.' }}</p>
          </div>
          <ui-button
            variant="secondary"
            :loading="billingBusy"
            :disabled="billingBusy"
            :aria-label="tr.manageBilling || 'Manage billing'"
            @click="handleManageBilling"
          >
            <v-remixicon name="riExternalLinkLine" class="mr-1" />
            {{ tr.manageBilling || 'Manage billing' }}
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

        <div class="beaver-sync-ready">
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
      <div class="flex items-center justify-between">
        <p class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
          {{ translations.account?.activeSessions || 'Active sessions' }}
        </p>
        <ui-button variant="secondary" size="sm" @click="loadSessions">
          <v-remixicon name="riRefreshLine" size="14" class="mr-1" />
          {{ translations.settings?.syncNow || 'Refresh' }}
        </ui-button>
      </div>
      <div
        class="space-y-1 bg-neutral-50 dark:bg-neutral-800 rounded-xl border"
      >
        <div v-if="loadingSessions" class="px-4 py-6 text-center">
          <div class="animate-spin inline-block">
            <v-remixicon name="riLoader4Line" class="text-neutral-400" size="20" />
          </div>
        </div>
        <div v-else-if="!sessions.length" class="px-4 py-3.5">
          <p class="text-xs text-neutral-500 dark:text-neutral-400">
            {{ translations.account?.noSessions || 'No active sessions' }}
          </p>
        </div>
        <div
          v-for="session in sessions"
          :key="session.id"
          class="flex items-center gap-3 px-4 py-3.5"
        >
          <div
            class="shrink-0 w-9 h-9 rounded-lg bg-neutral-100 dark:bg-neutral-900 flex items-center justify-center"
          >
            <v-remixicon :name="session.deviceInfo?.platform === 'mobile' ? 'riSmartphoneLine' : 'riComputerLine'" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate">
              {{ session.deviceInfo?.label || session.userAgent || 'Unknown session' }}
            </p>
            <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400 truncate">
              {{ session.createdAt ? new Date(session.createdAt).toLocaleString() : '' }}
              <span v-if="session.expiresAt"> · expires {{ new Date(session.expiresAt).toLocaleDateString() }}</span>
            </p>
          </div>
          <ui-button
            icon
            variant="danger"
            size="sm"
            @click="revokeSession(session.id)"
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
        <!-- Change password -->
        <div class="border-t border-neutral-200 dark:border-neutral-700 px-4 py-3.5">
          <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">{{ tr.changePassword || 'Change password' }}</p>
          <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{{ tr.changePasswordDescription || 'Verifies current password, rotates, revokes other sessions.' }}</p>
          <div class="mt-2 flex flex-col gap-2">
            <ui-input v-model="changeCurrent" :password="true" :placeholder="tr.currentPasswordPlaceholder || 'Current password'" :aria-label="tr.currentPasswordPlaceholder || 'Current password'" class="w-full" />
            <ui-input v-model="changeNew" :password="true" :placeholder="tr.newPasswordPlaceholder || 'New password (min 12 chars)'" :aria-label="tr.newPasswordPlaceholder || 'New password (min 12 chars)'" class="w-full" />
            <ui-input v-model="changeConfirm" :password="true" :placeholder="tr.confirmPasswordPlaceholder || 'Confirm new password'" :aria-label="tr.confirmPasswordPlaceholder || 'Confirm new password'" class="w-full" />
            <p v-if="changeMessage" class="text-xs" :class="changeSuccess ? 'text-green-600' : 'text-red-500'">{{ changeMessage }}</p>
            <ui-button variant="secondary" :loading="changeBusy" :aria-label="tr.changePassword || 'Change password'" @click="handleChangePassword">{{ tr.changePassword || 'Change password' }}</ui-button>
          </div>
        </div>
        <!-- Recovery code -->
        <div class="border-t border-neutral-200 dark:border-neutral-700 px-4 py-3.5">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                {{ tr.recoveryCode || 'Recovery code' }}
              </p>
              <p class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                {{ tr.recoveryCodeDescription || 'Single code to recover your account if you lose all passkeys. Regenerating invalidates the old code. Restores ACCOUNT access only — E2E data needs vault passphrase.' }}
              </p>
              <p v-if="recoveryCode" class="mt-2 font-mono text-xs break-all bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 text-amber-900 dark:text-amber-100">
                {{ recoveryCode }}
              </p>
              <p v-if="recoveryCode" class="mt-1 text-xs text-amber-700 dark:text-amber-400">
                {{ tr.recoveryCodeHint || 'Copy now — this code will not be shown again. Store it securely.' }}
              </p>
            </div>
            <ui-button variant="secondary" :loading="recoveryBusy" :aria-label="recoveryCode ? (tr.regenerate || 'Regenerate') : (tr.generate || 'Generate')" @click="handleGenerateRecoveryCode">
              {{ recoveryCode ? (tr.regenerate || 'Regenerate') : (tr.generate || 'Generate') }}
            </ui-button>
          </div>
        </div>
      </div>
    </section>

    <section class="space-y-2 beaver-sync-ready">
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
        <div class="flex items-center justify-between gap-3">
          <div class="space-y-0.5">
            <p class="text-sm font-medium text-red-900 dark:text-red-100">
              {{ translations.account?.exportData || 'Export account data' }}
            </p>
            <p class="text-xs leading-relaxed text-red-700 dark:text-red-300">
              {{ translations.account?.exportDataBody || 'Download a copy of your account information.' }}
            </p>
          </div>
          <ui-button variant="secondary" @click="exportAccountData">
            <v-remixicon name="riDownloadLine" class="mr-1" />
            {{ translations.account?.exportData || 'Export' }}
          </ui-button>
        </div>

        <div class="border-t border-red-200 dark:border-red-800" />

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
            :password="true"
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
import { generateRecoveryCode as apiGenerateRecoveryCode, requestEmailVerification as apiRequestEmailVerification, changePassword as apiChangePassword } from '@/lib/api/account';
import { createCheckoutSession, createPortalSession } from '@/lib/api/billing';

export default {
  setup() {
    const router = useRouter();
    const dialog = useDialog();
    const { translations } = useTranslations();
    const tr = computed(() => translations.value?.account || {});
    function fmt(key, params) {
      const raw = tr.value[key] ?? key;
      if (!params) return raw;
      return Object.entries(params).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), raw);
    }
    const accountStore = useAccountStore();
    const account = useSettingsAccount({ dialog, translations });

    const showVaultImportPrompt = ref(false);
    const showForgot = ref(false);
    const forgotEmail = ref('');
    const forgotBusy = ref(false);
    const forgotMessage = ref('');
    const forgotSent = ref(false);
    async function handleForgot() {
      forgotMessage.value = ''; forgotSent.value = false;
      const email = forgotEmail.value.trim() || accountStore.profile?.email || '';
      if (!email) { forgotMessage.value = 'Enter your email.'; return; }
      forgotBusy.value = true;
      try {
        const { requestPasswordReset } = await import('@/lib/api/auth');
        const res = await requestPasswordReset(email, { baseUrl: accountStore.serverUrl });
        forgotMessage.value = res?.message || 'If an account exists for that email, you will receive a password reset link. Check your inbox (and spam folder).';
        forgotSent.value = true;
      } catch (e) { forgotMessage.value = e?.message || 'Failed.'; } finally { forgotBusy.value = false; }
    }
    const changeCurrent = ref('');
    const changeNew = ref('');
    const changeConfirm = ref('');
    const changeBusy = ref(false);
    const changeMessage = ref('');
    const changeSuccess = ref(false);
    async function handleChangePassword() {
      changeMessage.value = ''; changeSuccess.value = false;
      if (!changeCurrent.value || !changeNew.value) { changeMessage.value = 'All fields required.'; return; }
      if (changeNew.value.length < 12) { changeMessage.value = 'New password must be at least 12 characters.'; return; }
      if (changeNew.value !== changeConfirm.value) { changeMessage.value = 'Passwords do not match.'; return; }
      changeBusy.value = true;
      try {
        await apiChangePassword(changeCurrent.value, changeNew.value, { baseUrl: accountStore.serverUrl });
        changeMessage.value = 'Password changed. Other sessions revoked.';
        changeSuccess.value = true;
        changeCurrent.value = ''; changeNew.value = ''; changeConfirm.value = '';
      } catch (e) { changeMessage.value = e?.message || 'Failed to change password.'; } finally { changeBusy.value = false; }
    }
    const recoveryCode = ref('');
    const recoveryBusy = ref(false);
    const billingBusy = ref(false);
    const billingError = ref('');
    const billingMessage = ref('');
    const billingSuccess = ref(false);
    const billingOptions = [
      { key: 'starter-monthly', plan: 'starter', interval: 'monthly', label: 'Starter Monthly' },
      { key: 'starter-yearly', plan: 'starter', interval: 'yearly', label: 'Starter Yearly' },
      { key: 'pro-monthly', plan: 'pro', interval: 'monthly', label: 'Pro Monthly' },
      { key: 'pro-yearly', plan: 'pro', interval: 'yearly', label: 'Pro Yearly' },
      { key: 'team-monthly', plan: 'team', interval: 'monthly', label: 'Team Monthly' },
      { key: 'team-yearly', plan: 'team', interval: 'yearly', label: 'Team Yearly' },
    ];
    async function openBillingUrl(url) {
      billingError.value = '';
      if (!url) return;
      try {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(url);
      } catch {
        window.open(url, '_blank', 'noopener');
      }
    }
    async function handleCheckout(plan, interval) {
      billingBusy.value = true;
      billingError.value = '';
      billingMessage.value = '';
      try {
        const res = await createCheckoutSession(plan, interval, { baseUrl: accountStore.serverUrl });
        const url = res?.url;
        if (url) await openBillingUrl(url);
        else throw new Error('No checkout URL returned');
        billingMessage.value = 'Checkout opened in browser. Complete payment there; subscription activates shortly via webhook.';
        billingSuccess.value = true;
      } catch (e) {
        const msg = e?.body?.error === 'EMAIL_NOT_VERIFIED'
          ? 'Please verify your email before upgrading.'
          : (e?.message || 'Failed to start checkout.');
        billingError.value = msg;
        dialog.alert({ title: 'Checkout failed', body: msg, okText: 'Close' });
      } finally {
        billingBusy.value = false;
      }
    }
    async function handleManageBilling() {
      billingBusy.value = true;
      billingError.value = '';
      try {
        const res = await createPortalSession({ baseUrl: accountStore.serverUrl });
        const url = res?.url;
        if (url) await openBillingUrl(url);
        else throw new Error('No portal URL returned');
      } catch (e) {
        const msg = e?.message || 'Failed to open billing portal.';
        billingError.value = msg;
        dialog.alert({ title: 'Billing portal failed', body: msg, okText: 'Close' });
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
        billingMessage.value = 'Billing return received. If you completed checkout, your subscription will activate shortly.';
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
        if (url.searchParams.get('session_id') || url.searchParams.get('canceled') || url.pathname.includes('billing/return')) {
          handleBillingReturn();
        }
      } catch {}
      // lazy import deep-link listener if available
      import('@tauri-apps/plugin-deep-link').then((m) => {
        const onOpenUrl = m.onOpenUrl || m.getCurrent || null;
        if (typeof onOpenUrl === 'function') {
          onOpenUrl((urls) => {
            const list = Array.isArray(urls) ? urls : [urls];
            if (list.some((u) => String(u).includes('billing/return'))) handleBillingReturn();
          }).catch(() => {});
        }
      }).catch(() => {});
    });
    const emailVerifySending = ref(false);
    const emailVerifyCooldown = ref(0);
    let emailVerifyTimer = null;
    async function handleRequestEmailVerification() {
      if (emailVerifySending.value || emailVerifyCooldown.value > 0) return;
      emailVerifySending.value = true;
      try {
        await apiRequestEmailVerification({ baseUrl: accountStore.serverUrl });
        dialog.alert({ title: 'Verification email sent', body: 'Check your inbox for the verification link (expires in 24 hours).', okText: 'Close' });
        emailVerifyCooldown.value = 60;
        emailVerifyTimer = setInterval(() => {
          emailVerifyCooldown.value -= 1;
          if (emailVerifyCooldown.value <= 0) { clearInterval(emailVerifyTimer); emailVerifyTimer = null; }
        }, 1000);
      } catch (e) {
        dialog.alert({ title: 'Failed to send', body: e?.message || 'Failed to send verification email.', okText: 'Close' });
      } finally {
        emailVerifySending.value = false;
      }
    }

    // Detect whether the sync source holds a vault differing from this device's
    // local manifest. hasRemoteVaultKeyParams() is authoritative — true when the
    // remote vault differs OR no local manifest exists — so the prompt shows even
    // when a (possibly wrong) local key is loaded; fetchCloudKeyParams() refreshes first.
    async function checkVaultImportNeeded() {
      if (!accountStore.isAuthenticated) {
        showVaultImportPrompt.value = false;
        return;
      }
      try {
        const { fetchCloudKeyParams } = await import('@/utils/sync/vault-key-params.js');
        const { hasRemoteVaultKeyParams } = await import('@/utils/crypto/encryption.js');
        await fetchCloudKeyParams({ force: true }).catch(() => null);
        showVaultImportPrompt.value = await hasRemoteVaultKeyParams();
      } catch {
        showVaultImportPrompt.value = false;
      }
    }

    function goToSecurity() {
      router.push('/settings/security');
    }

    async function importVaultDialog() {
      dialog.confirm({
        title: translations.value?.account?.importVaultTitle || 'Import vault from sync',
        body: translations.value?.account?.importVaultBody || 'Importing will replace this device\'s encryption key. Notes encrypted with a different key may no longer be readable.',
        icon: 'riShieldKeyholeLine',
        okText: translations.value?.account?.importVault || 'Import',
        cancelText: translations.value.dialog?.cancel || 'Cancel',
        onConfirm: () => {
          dialog.prompt({
            title: translations.value?.account?.vaultPasswordTitle || 'Enter vault password',
            body: translations.value?.account?.vaultPasswordBody || 'Enter the password for the existing encrypted vault in your sync source.',
            icon: 'riLockLine',
            okText: translations.value?.account?.importVault || 'Import',
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
                const { getFetchedCloudKeyParams } = await import('@/utils/sync/vault-key-params.js');
                const fetched = getFetchedCloudKeyParams();
                const res = await adoptVaultKey(pass, fetched?.paramsBlob);
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
                  title: translations.value?.account?.vaultImported || 'Vault imported',
                  body: translations.value?.account?.vaultImportedBody || 'The vault has been imported. The app will reload.',
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
        const res = await apiGenerateRecoveryCode({ baseUrl: accountStore.serverUrl });
        recoveryCode.value = res?.recoveryCode || '';
        dialog.alert({
          title: 'Recovery code generated',
          body: 'Store this code securely — it will not be shown again. Regenerating invalidates the old code. This restores ACCOUNT access only; E2E data needs vault passphrase.',
          okText: 'Close',
        });
        // enrollment offer: prompt to add passkey if missing
        if (accountStore.devices.length === 0) {
          dialog.confirm({
            title: 'Add a passkey?',
            body: 'You should add a passkey so you do not need the recovery code for daily sign-in.',
            okText: 'Add passkey',
            cancelText: 'Later',
            onConfirm: () => router.push('/settings/security'),
          });
        }
      } catch (e) {
        dialog.alert({ title: 'Failed to generate', body: e?.message || 'Failed to generate recovery code.', okText: 'Close' });
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

    return {
      translations,
      tr,
      fmt,
      PLAN_NAMES,
      accountStore,
      seedPhaseLabel,
      seedProgressPercent,
      showVaultImportPrompt,
      goToSecurity,
      importVaultDialog,
      showForgot, forgotEmail, forgotBusy, forgotMessage, forgotSent, handleForgot,
      changeCurrent, changeNew, changeConfirm, changeBusy, changeMessage, changeSuccess, handleChangePassword,
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
      handleCheckout,
      handleManageBilling,
      handleBillingReturn,
      ...account,
    };
  },
};
</script>
