<template>
  <app-command-prompt />
  <app-navbar v-show="showMobileNavbar" class="block md:hidden" />
  <app-sidebar v-show="showSidebar" class="hidden md:flex" />
  <div
    v-show="store.inReaderMode"
    class="fixed top-0 left-0 w-full h-full pointer-events-none z-50"
  ></div>

  <div
    v-show="updateBanner.show"
    class="flex fixed bottom-0 mx-auto align-center items-center w-full z-50"
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

  <main
    v-if="retrieved"
    data-testid="app-main"
    :class="{ 'md:pl-16 print:p-2': showSidebar }"
    :style="mainStyle"
  >
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
  <div
    v-show="appStore.loading"
    class="fixed w-full h-full top-0 left-0 z-50 flex justify-center items-center bg-opacity-40 bg-black"
  >
    <ui-spinner :size="50" />
  </div>

  <ui-dialog />
</template>

<script>
import AppSidebar from './components/app/AppSidebar.vue';
import AppCommandPrompt from './components/app/AppCommandPrompt.vue';
import { useAppShell } from './composable/useAppShell';
import AppNavbar from './components/app/AppNavbar.vue';

export default {
  components: {
    AppSidebar,
    AppCommandPrompt,
    AppNavbar,
  },
  setup() {
    return useAppShell();
  },
};
</script>
