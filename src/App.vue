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
  <app-encryption-gate
    v-if="appEncryptionGate.show"
    @unlocked="appEncryptionGate.show = false"
  />

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
    <app-sidebar v-show="showSidebar" class="mobile:hidden shrink-0" aria-label="Sidebar" />
    <main
      id="app-main"
      ref="mainRef"
      v-if="retrieved"
      data-testid="app-main"
      class="flex-1 min-w-0 overflow-y-auto mobile:pl-0 print:p-2"
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
import { ref, onMounted } from 'vue';
import ImportFolderPicker from './components/home/ImportFolderPicker.vue';
import AppSidebar from './components/app/AppSidebar.vue';
import AppCommandPrompt from './components/app/AppCommandPrompt.vue';
import UndoBanner from './components/app/UndoBanner.vue';
import AppEncryptionGate from './components/AppEncryptionGate.vue';
import { useAppShell } from './composable/useAppShell';
import AppNavbar from './components/app/AppNavbar.vue';

export default {
  components: {
    AppSidebar,
    AppCommandPrompt,
    UndoBanner,
    AppNavbar,
    ImportFolderPicker,
    AppEncryptionGate,
  },
  setup() {
    const shell = useAppShell();
    const mainRef = ref(null);

    function skipToMain() {
      const main = document.getElementById('app-main');
      if (main) {
        main.focus();
      }
    }

    onMounted(() => {
      if (typeof window.requestIdleCallback === 'undefined') return;
      window.requestIdleCallback(
        () => {
          import('./pages/note/_id.vue');
          import('./pages/folder/_id.vue');
          import('@/lib/tiptap/index.js').then((m) => m.prewarmEditor());
        },
        { timeout: 2000 }
      );
    });

    return { ...shell, mainRef, skipToMain };
  },
};
</script>
