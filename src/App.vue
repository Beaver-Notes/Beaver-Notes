<template>
  <div
    v-show="showSafeAreaOverlay"
    class="safe-area-overlay safe-area-overlay--top"
  />
  <app-command-prompt />
  <div
    id="pill-dock"
    class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-2"
    :class="uiState.inReaderMode ? 'mobile:bottom-[calc(var(--app-keyboard-inset-bottom)+1rem)]' : 'mobile:bottom-[calc(var(--app-keyboard-inset-bottom)+4.25rem)]'"
  ></div>
  <div
    v-if="showVerificationBanner"
    class="fixed top-3 inset-x-0 z-40 flex justify-center px-4 pointer-events-none"
    role="status"
  >
    <ui-pill :fixed="false" class="pointer-events-auto max-w-[calc(100vw-2rem)]">
      <div class="flex items-center gap-1.5 py-1 pl-1.5 pr-1">
        <v-remixicon name="riMailLine" class="text-lg text-amber-500 shrink-0" />
        <p class="min-w-0 text-xs font-medium text-neutral-700 dark:text-neutral-200">
          Please verify your email. Check your inbox for a verification link.
        </p>
        <button
          class="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          :disabled="verificationSending || verificationCooldown > 0"
          @click="handleRequestVerification"
        >
          {{ verificationCooldown > 0 ? `Resend (${verificationCooldown}s)` : verificationSending ? 'Sending…' : 'Resend email' }}
        </button>
      </div>
    </ui-pill>
  </div>
  <recording-pill />
  <app-encryption-gate
    v-if="appEncryptionGate.show"
    @unlocked="handleEncryptionUnlocked"
  />

  <a
    href="#app-main"
    class="sr-only focus:not-sr-only focus:fixed focus:top-2 ltr:focus:left-2 rtl:focus:right-2 focus:z-[200] focus:bg-primary focus:text-white focus:px-4 focus:py-2 focus:rounded-lg focus:shadow-lg focus:outline-none"
    @click.prevent="skipToMain"
  >
    Skip to content
  </a>

  <div
    v-show="showMobileNavbar"
    class="fixed inset-x-0 z-40 flex justify-center px-4 no-print mobile:block hidden"
    :style="mobileNavbarStyle"
  >
    <app-navbar />
  </div>

  <div class="flex h-screen w-screen overflow-hidden">
    <app-sidebar
      v-if="onboardingCompleted"
      v-show="showSidebar"
      class="mobile:hidden shrink-0"
      aria-label="Sidebar"
    />
    <main
      id="app-main"
      ref="mainRef"
      v-if="retrieved"
      data-testid="app-main"
      class="flex-1 min-w-0 overflow-y-auto mobile:pl-0 mobile:scroll-pb-[calc(var(--app-keyboard-inset-bottom)+4.5rem)] print:p-2"
      :style="mainStyle"
      tabindex="-1"
    >
      <div
        v-show="uiState.inReaderMode"
        class="fixed top-0 ltr:left-0 rtl:right-0 w-full h-full pointer-events-none z-50"
      ></div>

      <div
        v-show="updateBanner.show"
        class="fixed bottom-6 inset-x-0 z-[70] flex justify-center px-4 pointer-events-none"
        :style="bottomBannerStyle"
      >
        <ui-banner
          :content="updateBanner.content"
          :primary-text="updateBanner.primaryText"
          :secondary-text="updateBanner.secondaryText"
          @button-1="handleUpdateInstall"
          @button-2="handleUpdateDismiss"
        />
      </div>

      <div
        v-show="appEncryptionMigrationBanner.show"
        class="fixed bottom-6 inset-x-0 z-[70] flex justify-center px-4 pointer-events-none"
        :class="updateBanner.show ? 'mb-16' : ''"
        :style="bottomBannerStyle"
      >
        <ui-banner
          icon="riLockLine"
          :content="appEncryptionMigrationBannerCopy.content"
          :primary-text="appEncryptionMigrationBannerCopy.primaryText"
          :secondary-text="appEncryptionMigrationBannerCopy.secondaryText"
          @button-1="openAppEncryptionMigrationSettings"
          @button-2="dismissAppEncryptionMigrationBanner"
        />
      </div>

      <div
        class="fixed bottom-6 z-[70] flex justify-center pointer-events-none"
        :style="undoBannerWrapperStyle"
      >
        <undo-banner :position-style="bottomBannerStyle" :fixed="false" />
      </div>

      <div class="route-stage">
        <router-view v-slot="{ Component, route: viewRoute }">
          <transition :name="animateRouteChange ? 'route-stage' : undefined">
            <component
              :is="Component"
              :key="getTopLevelRouteKey(viewRoute)"
              class="route-stage__page"
            />
          </transition>
        </router-view>
      </div>
    </main>
  </div>

  <ui-dialog />

  <import-folder-picker
    v-model="showImportDialog"
    :note-title="importNoteTitle"
    @confirm="handleImportConfirm"
    @cancel="handleImportCancel"
  />

  <div
    id="a11y-live-region"
    aria-live="polite"
    aria-atomic="true"
    class="sr-only"
  ></div>
</template>

<script>
import { ref, watch, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import ImportFolderPicker from './components/home/ImportFolderPicker.vue';
import AppSidebar from './components/app/AppSidebar.vue';
import AppCommandPrompt from './components/app/AppCommandPrompt.vue';
import UndoBanner from './components/app/UndoBanner.vue';
import AppEncryptionGate from './components/app/AppEncryptionGate.vue';
import RecordingPill from './components/note/RecordingPill.vue';
import { useAppShell } from './composable/useAppShell';
import { getWsSync } from '@/lib/sync/ws-sync';
import { useAccountStore } from './store/account';
import { useCloudWorkspaces } from './composable/useCloudWorkspaces';
import { useDevicePasswordSetup } from './composable/useDevicePasswordSetup';
import AppNavbar from './components/app/AppNavbar.vue';
import { getSettingSync } from '@/lib/settings';
import { useTranslations } from '@/composable/useTranslations';

export default {
  components: {
    AppSidebar,
    AppCommandPrompt,
    UndoBanner,
    AppNavbar,
    ImportFolderPicker,
    AppEncryptionGate,
    RecordingPill,
  },
  setup() {
    const { translations } = useTranslations();
    const onboardingCompleted = ref(getSettingSync('onboardingCompleted'));
    const shell = useAppShell(onboardingCompleted.value);
    const mainRef = ref(null);
    const accountStore = useAccountStore();
    const cloudWorkspaces = useCloudWorkspaces();
    const {
      setupState: devicePasswordSetupState,
      maybePrompt: maybePromptDevicePassword,
    } = useDevicePasswordSetup();
    const route = useRoute();

    watch(
      () => accountStore.isAuthenticated,
      async (authenticated) => {
        if (authenticated) {
          await cloudWorkspaces.fetchWorkspaces();
        }
      },
      { immediate: true },
    );

    // Device-password re-entry makes master key readable, but startup hydration already failed: re-run minimal hydration.
    const hydrateAccountSessionAfterDeviceUnlock = async () => {
      if (accountStore.isAuthenticated) return;
      const { loadSessionToken } = await import('@/lib/account-storage');
      const token = await loadSessionToken().catch(() => null);
      if (!token) return;
      accountStore.setToken(token);
      accountStore.setStatus('authenticated');
      import('@/lib/api/account')
        .then(({ getAccount }) =>
          getAccount({ baseUrl: accountStore.serverUrl }).then((data) => {
            if (!data) return;
            accountStore.setProfile(data.profile);
            accountStore.setSubscription(data.subscription);
            accountStore.setDevices(data.devices || []);
          }),
        )
        .catch(() => {});
      const { useWorkspaceStore } = await import('@/store/workspace.ts');
      useWorkspaceStore()
        .retrieve()
        .catch((err) =>
          console.warn(
            '[app] workspace hydrate after device unlock failed:',
            err,
          ),
        );
    };

    watch(devicePasswordSetupState, async (state) => {
      if (state !== 'done') return;
      await hydrateAccountSessionAfterDeviceUnlock();
      // Keychain blob may be decryptable now: retry auto-unlock so gate hides.
      try {
        await shell.restoreEncryptionKeys();
      } catch (e) {
        console.warn('[app] encryption restore after device unlock failed:', e);
      }
    });

    // When onboarding completes and we leave the Onboarding route, flip the
    // reactive flag. This triggers the watcher below which starts init + ws-sync.
    watch(
      () => route.name,
      (name) => {
        if (name !== 'Onboarding' && !onboardingCompleted.value) {
          const done = getSettingSync('onboardingCompleted');
          if (done) onboardingCompleted.value = true;
        }
      },
    );

    // When onboardingCompleted flips true (first-time user finishing onboarding),
    // run the shell init in the background and start ws-sync.
    watch(onboardingCompleted, async (val) => {
      if (val) {
        try {
          await shell.initializeWorkspace();
        } catch (err) {
          console.error('[app] workspace init after onboarding failed:', err);
        }
        const wsSync = getWsSync();
        wsSync.start();
      }
    });

    function skipToMain() {
      const main = document.getElementById('app-main');
      if (main) {
        main.focus();
      }
    }

    // Soft-gate banner: unverified but authenticated shows nag with throttled resend.
    const verificationSending = ref(false);
    const verificationCooldown = ref(0);
    let cooldownTimer = null;
    const showVerificationBanner = computed(() => {
      if (!accountStore.isAuthenticated) return false;
      const v = accountStore.profile?.emailVerified;
      // Null means legacy/unknown: treat as verified to avoid nagging old installs.
      if (v === null || v === undefined) return false;
      return v === false;
    });
    async function handleRequestVerification() {
      if (verificationSending.value || verificationCooldown.value > 0) return;
      verificationSending.value = true;
      try {
        const { requestEmailVerification } = await import('@/lib/api/account');
        await requestEmailVerification({ baseUrl: accountStore.serverUrl });
        verificationCooldown.value = 60;
        cooldownTimer = setInterval(() => {
          verificationCooldown.value -= 1;
          if (verificationCooldown.value <= 0) {
            clearInterval(cooldownTimer);
            cooldownTimer = null;
          }
        }, 1000);
      } catch (err) {
        console.warn('[verify] request failed:', err?.message);
      } finally {
        verificationSending.value = false;
      }
    }

    onMounted(() => {
      if (onboardingCompleted.value) {
        const wsSync = getWsSync();
        wsSync.start();
      }
      maybePromptDevicePassword();
    });

    onBeforeUnmount(() => {
      if (onboardingCompleted.value) {
        const wsSync = getWsSync();
        wsSync.stop();
      }
      if (cooldownTimer) clearInterval(cooldownTimer);
    });

    return {
      ...shell,
      mainRef,
      skipToMain,
      onboardingCompleted,
      translations,
      showVerificationBanner,
      verificationSending,
      verificationCooldown,
      handleRequestVerification,
    };
  },
};
</script>
