<template>
  <aside
    class="w-16 text-neutral-500 dark:text-neutral-400 bg-white dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-800 fixed flex flex-col items-center h-full left-0 top-0 z-40 py-4 no-print"
  >
    <div class="flex flex-col items-center gap-3 w-full px-2">
      <button
        v-tooltip:right="
          translations.sidebar.addNotes + ' (' + keyBinding + '+N)'
        "
        data-testid="add-note-button"
        class="transition-all p-2.5 text-white bg-primary dark:bg-primary/50 hover:bg-primary/90 dark:hover:hover:bg-primary/60 rounded-xl flex items-center justify-center"
        @click="addNote"
      >
        <v-remixicon name="riAddFill" size="24" />
      </button>

      <button
        v-tooltip:right="
          translations.sidebar.newFolder + ' (' + keyBinding + '+Shift+F)'
        "
        class="transition-colors p-2 rounded-lg hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50 hover:text-neutral-900 dark:hover:text-neutral-100 flex items-center justify-center"
        @click="addFolder"
      >
        <v-remixicon name="riFolderAddLine" size="24" />
      </button>
    </div>

    <hr class="w-8 border-neutral-200 dark:border-neutral-800 my-4" />

    <div class="flex flex-col items-center gap-2 w-full">
      <div class="relative flex items-center justify-center w-full">
        <transition name="pill">
          <div
            v-if="$route.name === 'Note'"
            class="absolute left-0 w-1 h-6 bg-primary rounded-r-full"
          />
        </transition>
        <button
          v-tooltip:right="
            translations.sidebar.editedNote + ' (' + keyBinding + '+Shift+W)'
          "
          class="transition-all p-2 rounded-lg hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50 flex items-center justify-center"
          :class="[
            $route.name === 'Note'
              ? 'text-primary bg-primary/10'
              : 'hover:text-neutral-900 dark:hover:text-neutral-100',
          ]"
          @click="openLastEdited"
        >
          <v-remixicon name="riEditLine" size="24" />
        </button>
      </div>

      <div
        v-for="nav in navs"
        :key="nav.name"
        class="relative flex items-center justify-center w-full"
      >
        <transition name="pill">
          <div
            v-if="$route.fullPath === nav.path"
            class="absolute left-0 w-1 h-6 bg-primary rounded-r-full"
          />
        </transition>
        <button
          v-tooltip:right="
            `${nav.name} (${nav.shortcut.replace('mod', keyBinding)})`
          "
          :data-testid="getNavTestId(nav.path)"
          class="transition-all p-2 rounded-lg hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50 flex items-center justify-center"
          :class="[
            $route.fullPath === nav.path
              ? 'text-primary bg-primary/10'
              : 'hover:text-neutral-900 dark:hover:text-neutral-100',
          ]"
          @click="handleNavigation(nav)"
        >
          <v-remixicon :name="nav.icon" size="24" />
        </button>
      </div>
    </div>

    <div class="flex-grow" />

    <div class="flex flex-col items-center gap-2 w-full">
      <button
        v-tooltip:right="
          translations.sidebar.toggleSync + ' (' + keyBinding + '+Shift+Y)'
        "
        class="transition-colors p-2 rounded-lg hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50 hover:text-neutral-900 dark:hover:text-neutral-100 flex items-center justify-center"
        :class="{ 'text-primary': spinning }"
        @click="manualSync"
      >
        <v-remixicon
          name="riLoopRightLine"
          size="24"
          :class="{ 'animate-spin': spinning }"
        />
      </button>

      <button
        v-tooltip:right="
          translations.sidebar.toggleDarkTheme + ' (' + keyBinding + '+Shift+L)'
        "
        class="transition-colors p-2 rounded-lg hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50 flex items-center justify-center"
        @click="theme.setTheme(theme.isDark() ? 'light' : 'dark')"
      >
        <v-remixicon
          size="24"
          :class="
            theme.isDark()
              ? 'text-primary'
              : 'text-neutral-500 hover:text-neutral-900'
          "
          :name="theme.isDark() ? 'riSunLine' : 'riMoonClearLine'"
        />
      </button>

      <hr class="w-8 border-neutral-200 dark:border-neutral-800 my-2" />

      <div class="relative flex items-center justify-center w-full pb-2">
        <transition name="pill">
          <div
            v-if="$route.path === '/settings'"
            class="absolute left-0 w-1 h-6 bg-primary rounded-r-full"
          />
        </transition>
        <router-link
          v-tooltip:right="
            translations.settings.title + ' (' + keyBinding + '+,)'
          "
          to="/settings"
          class="transition-all p-2 rounded-lg hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50 flex items-center justify-center"
          active-class="text-primary bg-primary/10"
          :class="[
            $route.path !== '/settings'
              ? 'hover:text-neutral-900 dark:hover:text-neutral-100'
              : '',
          ]"
        >
          <v-remixicon name="riSettingsLine" size="24" />
        </router-link>
      </div>
    </div>
  </aside>
</template>

<script>
import { onUnmounted, ref } from 'vue';
import { useTheme } from '@/composable/theme';
import emitter from 'tiny-emitter/instance';
import { forceSyncNow } from '@/utils/sync';
import { useGlobalShortcuts } from '@/composable/useGlobalShortcuts';
import { useAppShellActions } from '@/composable/useAppShellActions';

export default {
  setup() {
    const spinning = ref(false);
    const theme = useTheme();
    const {
      translations,
      navItems,
      addNote,
      addFolder,
      openSettings,
      openLastEdited,
      handleNavigation,
      createShortcutMap,
    } = useAppShellActions();
    const isMacOS = navigator.platform.toUpperCase().includes('MAC');
    const keyBinding = isMacOS ? 'Cmd' : 'Ctrl';
    const enableDarkTheme = () => theme.setTheme('dark');
    const enableLightTheme = () => theme.setTheme('light');

    emitter.on('new-note', addNote);
    emitter.on('new-folder', addFolder);
    emitter.on('open-settings', openSettings);
    emitter.on('dark', enableDarkTheme);
    emitter.on('light', enableLightTheme);

    if (typeof window !== 'undefined') {
      window.addNote = addNote;
    }

    useGlobalShortcuts(() =>
      createShortcutMap({
        'mod+shift+l': () => theme.setTheme(theme.isDark() ? 'light' : 'dark'),
        'mod+shift+y': () => manualSync(),
      })
    );

    onUnmounted(() => {
      emitter.off('new-note', addNote);
      emitter.off('new-folder', addFolder);
      emitter.off('open-settings', openSettings);
      emitter.off('dark', enableDarkTheme);
      emitter.off('light', enableLightTheme);
    });

    function getNavTestId(path) {
      if (path === '/') return 'nav-notes-button';
      if (path === '/?archived=true') return 'nav-archive-button';
      return null;
    }

    function manualSync() {
      spinning.value = true;
      forceSyncNow();
      setTimeout(() => {
        spinning.value = false;
      }, 1000);
    }

    return {
      navs: navItems,
      translations,
      theme,
      spinning,
      addNote,
      addFolder,
      manualSync,
      openLastEdited,
      keyBinding,
      handleNavigation,
      getNavTestId,
    };
  },
};
</script>

<style scoped>
.pill-enter-active,
.pill-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.pill-enter-from,
.pill-leave-to {
  transform: scaleY(0);
  opacity: 0;
}

.shadow-inner {
  box-shadow: inset 0 2px 4px 0 rgba(0, 0, 0, 0.04);
}

/* Hide scrollbar but keep scroll functionality */
.scrollbar-none {
  scrollbar-width: none;
}
.scrollbar-none::-webkit-scrollbar {
  display: none;
}

@media print {
  .no-print {
    display: none !important;
  }
}
</style>
