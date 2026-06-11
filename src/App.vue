<template>
  <app-command-prompt />
  <div
    v-show="showMobileNavbar"
    class="fixed inset-x-0 z-40 flex justify-center px-4 no-print mobile:block hidden"
    :style="mobileNavbarStyle"
  >
    <app-navbar />
  </div>

  <div class="flex h-screen w-screen overflow-hidden">
    <app-sidebar v-show="showSidebar" class="mobile:hidden shrink-0" />
    <main
      v-if="retrieved"
      data-testid="app-main"
      class="flex-1 min-w-0 overflow-y-auto mobile:pl-0 print:p-2"
      :style="mainStyle"
    >
      <div
        v-show="store.inReaderMode"
        class="fixed top-0 left-0 w-full h-full pointer-events-none"
        style="z-index: 50"
      ></div>

      <div
        v-show="updateBanner.show"
        class="flex fixed bottom-0 mx-auto align-center items-center w-full"
        style="z-index: 50"
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
        class="flex fixed bottom-0 mx-auto align-center items-center w-full"
        style="z-index: 50"
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
        class="flex fixed bottom-0 mx-auto align-center items-center w-full"
        style="z-index: 50"
        :class="updateBanner.show || syncLockBanner.show ? 'mb-16' : ''"
        :style="bottomBannerStyle"
      >
        <ui-banner
          :content="
            appEncryptionMigrationBanner.status === 'in_progress'
              ? 'App encryption migration is in progress. Please wait for it to complete.'
              : 'App encryption migration did not complete. Please re-enable app encryption from Settings.'
          "
          primary-text="Open Settings"
          secondary-text="Dismiss"
          @button-1="openAppEncryptionMigrationSettings"
          @button-2="dismissAppEncryptionMigrationBanner"
        />
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
</template>

<script>
import ImportFolderPicker from './components/home/ImportFolderPicker.vue';
import AppSidebar from './components/app/AppSidebar.vue';
import AppCommandPrompt from './components/app/AppCommandPrompt.vue';
import { useAppShell } from './composable/useAppShell';
import AppNavbar from './components/app/AppNavbar.vue';

export default {
  components: {
    AppSidebar,
    AppCommandPrompt,
    AppNavbar,
    ImportFolderPicker,
  },
  setup() {
    return useAppShell();
  },
};
</script>
