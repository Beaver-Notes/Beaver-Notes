<template>
  <div
    v-show="showSafeAreaOverlay"
    class="safe-area-overlay safe-area-overlay--top"
  />
  <div
    v-show="showSafeAreaOverlay"
    class="safe-area-overlay safe-area-overlay--bottom"
  />
  <app-command-prompt />
  <recording-pill />
  <app-encryption-gate
    v-if="appEncryptionGate.show && !appEncryptionGate.deriving"
    @unlocked="handleEncryptionUnlocked"
  />
  <div
    v-if="appEncryptionGate.show && appEncryptionGate.deriving"
    class="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm"
  >
    <div class="flex flex-col items-center gap-3">
      <ui-spinner :size="36" />
      <span class="text-sm text-neutral-500 dark:text-neutral-400">
        Unlocking…
      </span>
    </div>
  </div>

  <a
    href="#app-main"
    class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:bg-primary focus:text-white focus:px-4 focus:py-2 focus:rounded-lg focus:shadow-lg focus:outline-none"
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
    <app-sidebar v-if="onboardingCompleted" v-show="showSidebar" class="mobile:hidden shrink-0" aria-label="Sidebar" />
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
        class="fixed top-0 left-0 w-full h-full pointer-events-none z-50"
      ></div>

      <div
        v-show="updateBanner.show"
        class="flex fixed bottom-0 mx-auto align-center items-center w-full z-50"
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
        v-show="syncLockBanner.show"
        class="flex fixed bottom-0 mx-auto align-center items-center w-full z-50"
        :class="updateBanner.show ? 'mb-16' : ''"
        :style="bottomBannerStyle"
      >
        <ui-banner
          :content="syncLockBannerCopy.content"
          :primary-text="syncLockBannerCopy.primaryText"
          :secondary-text="syncLockBannerCopy.secondaryText"
          @button-1="openSyncSettings"
          @button-2="dismissSyncBanner"
        />
      </div>

      <div
        v-show="appEncryptionMigrationBanner.show"
        class="flex fixed bottom-0 mx-auto align-center items-center w-full z-50"
        :class="updateBanner.show || syncLockBanner.show ? 'mb-16' : ''"
        :style="bottomBannerStyle"
      >
        <ui-banner
          :content="appEncryptionMigrationBannerCopy.content"
          :primary-text="appEncryptionMigrationBannerCopy.primaryText"
          :secondary-text="appEncryptionMigrationBannerCopy.secondaryText"
          @button-1="openAppEncryptionMigrationSettings"
          @button-2="dismissAppEncryptionMigrationBanner"
        />
      </div>

      <undo-banner :position-style="bottomBannerStyle" />

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

  <div
    v-show="appStore.loading"
    class="fixed w-full h-full top-0 left-0 z-50 flex justify-center items-center bg-opacity-40 bg-black"
  >
    <ui-spinner :size="50" />
  </div>

  <ui-dialog />

  <import-folder-picker
    v-model="showImportDialog"
    :note-title="importNoteTitle"
    @confirm="handleImportConfirm"
    @cancel="handleImportCancel"
  />

  <div id="a11y-live-region" aria-live="polite" aria-atomic="true" class="sr-only"></div>
</template>

<script>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import ImportFolderPicker from './components/home/ImportFolderPicker.vue';
import AppSidebar from './components/app/AppSidebar.vue';
import AppCommandPrompt from './components/app/AppCommandPrompt.vue';
import UndoBanner from './components/app/UndoBanner.vue';
import AppEncryptionGate from './components/app/AppEncryptionGate.vue';
import RecordingPill from './components/note/RecordingPill.vue';
import { useAppShell } from './composable/useAppShell';
import { getHocuspocusSync } from '@/lib/sync/hocuspocus-sync';
import { useAccountStore } from './store/account';
import { useCloudWorkspaces } from './composable/useCloudWorkspaces';
import { useDevicePasswordSetup } from './composable/useDevicePasswordSetup';
import AppNavbar from './components/app/AppNavbar.vue';
import { getSettingSync } from '@/lib/settings';

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
      { immediate: true }
    );

    // After a successful device-password re-entry, the master key becomes
    // readable again — but the startup session hydration already failed (it
    // ran before the KEK was supplied), so the user would stay logged out
    // until restart. Re-run the minimal hydration: load the now-readable
    // session token, mark the store authenticated, and fetch the profile.
    const hydrateAccountSessionAfterDeviceUnlock = async () => {
      if (accountStore.isAuthenticated) return;
      const { loadSessionToken } = await import('@/lib/account-storage');
      const token = await loadSessionToken().catch(() => null);
      if (!token) return;
      accountStore.setStatus('authenticated');
      import('@/lib/api/account')
        .then(({ getAccount }) =>
          getAccount({ baseUrl: accountStore.serverUrl }).then((data) => {
            if (!data) return;
            accountStore.setProfile(data.profile);
            accountStore.setSubscription(data.subscription);
            accountStore.setDevices(data.devices || []);
          })
        )
        .catch(() => {});
      const { useWorkspaceStore } = await import('@/store/workspace.ts');
      useWorkspaceStore()
        .retrieve()
        .catch((err) =>
          console.warn(
            '[app] workspace hydrate after device unlock failed:',
            err
          )
        );
    };

    watch(devicePasswordSetupState, async (state) => {
      if (state !== 'done') return;
      await hydrateAccountSessionAfterDeviceUnlock();
    });

    // When onboarding completes and we leave the Onboarding route, flip the
    // reactive flag. This triggers the watcher below which starts init + hocuspocus.
    watch(
      () => route.name,
      (name) => {
        if (name !== 'Onboarding' && !onboardingCompleted.value) {
          const done = getSettingSync('onboardingCompleted');
          if (done) onboardingCompleted.value = true;
        }
      }
    );

    // When onboardingCompleted flips true (first-time user finishing onboarding),
    // run the shell init in the background and start hocuspocus.
    watch(
      onboardingCompleted,
      (val) => {
        if (val) {
          shell.initializeWorkspace().catch((err) => {
            console.error('[app] workspace init after onboarding failed:', err);
          });
          const hocuspocus = getHocuspocusSync();
          hocuspocus.start();
        }
      }
    );

    function skipToMain() {
      const main = document.getElementById('app-main');
      if (main) {
        main.focus();
      }
    }

    onMounted(() => {
      if (onboardingCompleted.value) {
        const hocuspocus = getHocuspocusSync();
        hocuspocus.start();
      }
      maybePromptDevicePassword();
    });

    onBeforeUnmount(() => {
      if (onboardingCompleted.value) {
        const hocuspocus = getHocuspocusSync();
        hocuspocus.stop();
      }
    });

    return { ...shell, mainRef, skipToMain, onboardingCompleted };
  },
};
</script>
