<template>
  <aside
    class="flex flex-col h-full shrink-0 no-print transition-[width] duration-200 ease-[var(--ease-standard)] bg-white dark:bg-neutral-900 border-r border-neutral-200/40 dark:border-neutral-800/40 select-none"
    :class="expanded ? 'w-64' : 'w-16'"
    :style="{ paddingTop: titlebarInset }"
  >
    <div
      class="pt-5 px-3 mb-3 shrink-0"
      :class="expanded ? 'flex justify-end' : ''"
    >
      <button
        v-tooltip:right="expanded ? 'Collapse sidebar' : 'Expand sidebar'"
        :aria-label="expanded ? 'Collapse sidebar' : 'Expand sidebar'"
        class="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors"
        @click="toggleExpanded"
      >
        <v-remixicon
          name="riSideBarLine"
          size="20"
          :class="expanded ? 'rotate-180' : ''"
        />
      </button>
    </div>

    <div class="px-3 mb-4 shrink-0">
      <button
        v-tooltip:right="
          !expanded
            ? `${translations.sidebar.addNotes} (${keyBinding}+N)`
            : undefined
        "
        :aria-label="translations.sidebar.addNotes"
        data-testid="add-note-button"
        class="transition-all duration-200 ease-[var(--ease-snappy)] text-white bg-primary dark:bg-primary/50 hover:bg-primary/90 dark:hover:bg-primary/60 rounded-xl flex items-center justify-center overflow-hidden"
        :class="expanded ? 'px-4 gap-2 h-10 w-full' : 'p-0 w-9 h-9'"
        @click="addNote"
      >
        <v-remixicon
          name="riAddFill"
          size="20"
          class="transition-transform duration-200 ease-[var(--ease-snappy)] shrink-0"
        />
        <transition name="fade-fast">
          <span
            v-if="expanded"
            class="text-sm font-medium whitespace-nowrap truncate"
          >
            {{ translations.sidebar.addNotes }}
          </span>
        </transition>
      </button>
    </div>

    <div class="px-3 mb-4">
      <button
        v-tooltip:right="
          !expanded
            ? `${
                translations.sidebar.newFolder || 'New Folder'
              } (${keyBinding}+Shift+F)`
            : undefined
        "
        :aria-label="translations.sidebar.newFolder || 'New Folder'"
        class="transition-all duration-200 ease-[var(--ease-snappy)] rounded-lg flex items-center h-9 overflow-hidden"
        :class="[
          expanded ? 'w-full px-3 gap-3' : 'justify-center w-9',
          'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50 hover:text-neutral-900 dark:hover:text-neutral-100',
        ]"
        @click="addFolder"
      >
        <v-remixicon name="riFolderAddLine" size="20" class="shrink-0" />
        <transition name="fade-fast">
          <span
            v-if="expanded"
            class="text-sm font-medium whitespace-nowrap truncate"
          >
            {{ translations.sidebar.newFolder || 'New Folder' }}
          </span>
        </transition>
      </button>
    </div>

    <nav class="flex flex-col gap-1 px-3 shrink-0 relative">
      <div
        class="absolute left-0 w-1 bg-primary rounded-r-full transition-all duration-200 ease-[var(--ease-snappy)]"
        :style="pillStyle"
      />

      <button
        ref="homeBtn"
        v-tooltip:right="
          !expanded
            ? `${translations.sidebar.notes} (${keyBinding}+Shift+N)`
            : undefined
        "
        :aria-label="translations.sidebar.notes"
        data-testid="nav-notes-button"
        class="transition-all duration-200 ease-[var(--ease-snappy)] rounded-lg flex items-center h-9 overflow-hidden"
        :class="[
          expanded ? 'w-full px-3 gap-3' : 'justify-center w-9',
          isAllNotesActive
            ? 'text-primary bg-primary/10'
            : 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50 hover:text-neutral-900 dark:hover:text-neutral-100',
        ]"
        @click="goHome"
      >
        <v-remixicon
          name="riBookletLine"
          size="20"
          class="shrink-0 transition-transform duration-200"
          :class="{ 'scale-105': isAllNotesActive }"
        />
        <transition name="fade-fast">
          <span
            v-if="expanded"
            class="text-sm font-medium whitespace-nowrap truncate"
          >
            {{ translations.sidebar.notes || 'All Notes' }}
          </span>
        </transition>
      </button>

      <button
        ref="archiveBtn"
        v-tooltip:right="
          !expanded
            ? `${translations.sidebar.archive} (${keyBinding}+Shift+A)`
            : undefined
        "
        :aria-label="translations.sidebar.archive"
        data-testid="nav-archive-button"
        class="transition-all duration-200 ease-[var(--ease-snappy)] rounded-lg flex items-center h-9 overflow-hidden"
        :class="[
          expanded ? 'w-full px-3 gap-3' : 'justify-center w-9',
          isArchiveActive
            ? 'text-primary bg-primary/10'
            : 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50 hover:text-neutral-900 dark:hover:text-neutral-100',
        ]"
        @click="goArchive"
      >
        <v-remixicon
          name="riArchiveDrawerLine"
          size="20"
          class="shrink-0 transition-transform duration-200"
          :class="{ 'scale-105': isArchiveActive }"
        />
        <transition name="fade-fast">
          <span
            v-if="expanded"
            class="text-sm font-medium whitespace-nowrap truncate"
          >
            {{ translations.sidebar.archive || 'Archive' }}
          </span>
        </transition>
      </button>
    </nav>

    <ExpandTransition>
      <div
        v-show="expanded"
        class="mt-5 px-3 flex-1 min-h-0 overflow-y-auto scrollbar-none flex flex-col"
      >
        <div
          class="text-[11px] font-semibold uppercase tracking-widest text-neutral-400 dark:text-neutral-500 mb-2 px-3 select-none shrink-0"
        >
          Recent
        </div>
        <div v-if="recentItems.length > 0" class="flex flex-col gap-0.5">
          <button
            v-for="item in recentItems"
            :key="`${item.type}-${item.id}`"
            class="flex items-center gap-2 w-full min-w-0 px-3 py-1.5 rounded-lg hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50 transition-colors text-left group"
            :title="item.title"
            @click="
              item.type === 'folder' ? openFolder(item.id) : openNote(item.id)
            "
          >
            <span
              v-if="item.type === 'folder' && item.icon"
              size="14"
              class="select-none flex-shrink-0"
            >
              {{ item.icon }}
            </span>
            <v-remixicon
              v-if="!(item.type === 'folder' && item.icon)"
              :name="item.type === 'folder' ? 'riFolder5Fill' : 'riArticleLine'"
              size="14"
              class="text-neutral-400 shrink-0 transition-transform duration-200 group-hover:scale-105"
              :style="{
                color: item.type === 'folder' ? item.color : undefined,
              }"
            />
            <span
              class="text-sm truncate flex-1 min-w-0 text-neutral-600 dark:text-neutral-400"
            >
              {{ item.title }}
            </span>
            <span
              class="text-[11px] text-neutral-400 dark:text-neutral-500 shrink-0 tabular-nums"
            >
              {{ formatRelativeTime(item.updatedAt) }}
            </span>
          </button>
        </div>
        <div v-else class="px-3 py-1.5">
          <p class="text-xs text-neutral-400/80 italic">
            {{ translations.tray?.noRecentItems || 'No recent items' }}
          </p>
        </div>
      </div>
    </ExpandTransition>

    <div v-if="!expanded" class="flex-grow" />

    <div
      class="flex flex-col items-center gap-1 px-3 pb-4 pt-3 border-t border-neutral-200/50 dark:border-neutral-800/50 shrink-0 relative"
    >
      <div
        class="absolute left-0 w-1 bg-primary rounded-r-full transition-all duration-200 ease-[var(--ease-snappy)]"
        :style="footerPillStyle"
      />

      <button
        v-tooltip:right="
          !expanded
            ? `${translations.sidebar.toggleSync} (${keyBinding}+Shift+Y)`
            : undefined
        "
        :aria-label="translations.sidebar.toggleSync"
        class="transition-all duration-200 ease-[var(--ease-snappy)] rounded-lg hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50 flex items-center h-9 text-neutral-500 dark:text-neutral-400 overflow-hidden"
        :class="[
          expanded ? 'w-full px-3' : 'justify-center w-9',
          { '!text-primary': spinning },
        ]"
        @click="manualSync"
      >
        <v-remixicon
          name="riLoopRightLine"
          size="20"
          :class="{ 'animate-spin': spinning }"
          class="shrink-0 transition-transform duration-200"
        />
        <transition name="fade-fast">
          <span
            v-if="expanded"
            class="ml-3 text-sm text-neutral-600 dark:text-neutral-400 whitespace-nowrap truncate"
          >
            Sync
          </span>
        </transition>
      </button>

      <button
        v-tooltip:right="
          !expanded
            ? `${translations.sidebar.toggleDarkTheme} (${keyBinding}+Shift+L)`
            : undefined
        "
        :aria-label="translations.sidebar.toggleDarkTheme"
        class="transition-all duration-200 ease-[var(--ease-snappy)] rounded-lg hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50 flex items-center h-9 text-neutral-500 dark:text-neutral-400 overflow-hidden"
        :class="expanded ? 'w-full px-3' : 'justify-center w-9'"
        @click="theme.setTheme(theme.isDark() ? 'light' : 'dark')"
      >
        <v-remixicon
          size="20"
          :class="theme.isDark() ? 'text-primary' : ''"
          :name="theme.isDark() ? 'riSunLine' : 'riMoonClearLine'"
          class="shrink-0 transition-transform duration-200"
        />
        <transition name="fade-fast">
          <span
            v-if="expanded"
            class="ml-3 text-sm text-neutral-600 dark:text-neutral-400 whitespace-nowrap truncate"
          >
            {{ theme.isDark() ? 'Light' : 'Dark' }}
          </span>
        </transition>
      </button>

      <router-link
        ref="settingsBtn"
        v-tooltip:right="
          !expanded
            ? `${translations.settings.title} (${keyBinding}+,)`
            : undefined
        "
        :aria-label="translations.settings.title"
        to="/settings"
        class="transition-all duration-200 ease-[var(--ease-snappy)] rounded-lg hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50 flex items-center h-9"
        active-class="text-primary bg-primary/10"
        :class="[
          !isSettingsActive
            ? 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100'
            : '',
          expanded ? 'w-full px-3' : 'justify-center w-9',
        ]"
      >
        <v-remixicon
          name="riSettingsLine"
          size="20"
          class="shrink-0 transition-transform duration-200"
        />
        <transition name="fade-fast">
          <span
            v-if="expanded"
            class="ml-3 text-sm text-neutral-600 dark:text-neutral-400 whitespace-nowrap truncate"
          >
            {{ translations.settings.title }}
          </span>
        </transition>
      </router-link>

      <WorkspaceSwitcher :expanded="expanded" />
    </div>
  </aside>
</template>

<script>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useTheme } from '@/composable/theme';
import { useNoteStore } from '@/store/note';
import { useFolderStore } from '@/store/folder';
import emitter from 'tiny-emitter/instance';
import { forceSyncNow } from '@/utils/sync';
import { bindGlobalShortcuts } from '@/utils/ui/globalShortcuts.js';
import { useAppShellActions } from '@/composable/useAppShellActions';
import { useSounds } from '@/composable/useSounds';
import WorkspaceSwitcher from './WorkspaceSwitcher.vue';

export default {
  components: { WorkspaceSwitcher },
  setup() {
    const { play } = useSounds();
    const router = useRouter();
    const route = useRoute();
    const spinning = ref(false);
    const theme = useTheme();
    const noteStore = useNoteStore();
    const folderStore = useFolderStore();
    const titlebarInset = ref('0px');

    // DOM Element pointers to calculate indicator pill transitions cleanly
    const homeBtn = ref(null);
    const archiveBtn = ref(null);

    const settingsBtn = ref(null);

    const pillTop = ref(0);
    const pillHeight = ref(0);
    const footerPillTop = ref(0);
    const footerPillHeight = ref(0);

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

    onMounted(() => {
      const computedStyle = window.getComputedStyle(document.documentElement);

      const envTop = computedStyle
        .getPropertyValue('--safe-area-inset-top')
        .trim();
      if (envTop && envTop !== '0px') {
        titlebarInset.value = envTop;
      } else {
        titlebarInset.value = '0px';
      }

      if (typeof window !== 'undefined') {
        window.addNote = addNote;
      }

      calculatePillPositions();
    });

    const expanded = ref(localStorage.getItem('sidebarExpanded') !== 'false');

    function toggleExpanded() {
      expanded.value = !expanded.value;
      localStorage.setItem('sidebarExpanded', String(expanded.value));
      nextTick(() => calculatePillPositions());
    }

    // Fixed path structural matches for nested routes (`/settings/labels` won't drop parent highlight)
    const isAllNotesActive = computed(
      () =>
        (route.path === '/' || route.name === 'Home') &&
        route.query.archived !== 'true'
    );
    const isArchiveActive = computed(() => route.query.archived === 'true');

    const isSettingsActive = computed(() => route.path.startsWith('/settings'));

    // Compute active styles for a single fluid moving side indicator bar
    const pillStyle = computed(() => ({
      top: `${pillTop.value}px`,
      height: `${pillHeight.value}px`,
      opacity: pillHeight.value > 0 ? 1 : 0,
    }));

    const footerPillStyle = computed(() => ({
      top: `${footerPillTop.value}px`,
      height: `${footerPillHeight.value}px`,
      opacity: footerPillHeight.value > 0 ? 1 : 0,
    }));

    function calculatePillPositions() {
      // Main navigation pill calculations
      let activeNavEl = null;
      if (isAllNotesActive.value) activeNavEl = homeBtn.value;
      else if (isArchiveActive.value) activeNavEl = archiveBtn.value;

      if (activeNavEl && activeNavEl.$el ? activeNavEl.$el : activeNavEl) {
        const el = activeNavEl.$el || activeNavEl;
        pillTop.value = el.offsetTop + 6; // slightly centered
        pillHeight.value = el.offsetHeight - 12;
      } else {
        pillHeight.value = 0;
      }

      // Footer utilities pill calculations
      if (isSettingsActive.value && settingsBtn.value) {
        const el = settingsBtn.value.$el || settingsBtn.value;
        footerPillTop.value = el.offsetTop + 6;
        footerPillHeight.value = el.offsetHeight - 12;
      } else {
        footerPillHeight.value = 0;
      }
    }

    watch(
      () => route.fullPath,
      () => {
        nextTick(() => calculatePillPositions());
      }
    );

    function goHome() {
      router.push('/');
    }
    function goArchive() {
      router.push('/?archived=true');
    }

    function openNote(noteId) {
      router.push(`/note/${noteId}`);
    }

    function openFolder(folderId) {
      router.push(`/folder/${folderId}`);
    }

    const recentItems = computed(() => {
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const items = [];

      for (const note of Object.values(noteStore.data)) {
        if (note.id && !note.isArchived && note.updatedAt > cutoff) {
          items.push({
            id: note.id,
            updatedAt: note.updatedAt,
            title: note.title || 'Untitled',
            type: 'note',
          });
        }
      }

      for (const folder of Object.values(folderStore.data)) {
        if (
          folder.id &&
          !folderStore.deletedIds[folder.id] &&
          !folder.isArchived &&
          folder.updatedAt > cutoff
        ) {
          items.push({
            id: folder.id,
            updatedAt: folder.updatedAt,
            title: folder.name || 'Untitled',
            type: 'folder',
            icon: folder.icon || '',
            color: folder.color || '',
          });
        }
      }

      items.sort((a, b) => b.updatedAt - a.updatedAt);
      if (items.length > 8) items.length = 8;
      return items;
    });

    function formatRelativeTime(timestamp) {
      if (!timestamp) return '';
      const diffMs = Date.now() - timestamp;
      const diffMinutes = Math.floor(diffMs / 60000);

      if (diffMinutes < 1) return 'now';
      if (diffMinutes < 60) return `${diffMinutes}m`;
      const diffHours = Math.floor(diffMinutes / 60);
      if (diffHours < 24) return `${diffHours}h`;
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays < 7) return `${diffDays}d`;
      return `${Math.floor(diffDays / 7)}w`;
    }

    const enableDarkTheme = () => theme.setTheme('dark');
    const enableLightTheme = () => theme.setTheme('light');

    emitter.on('new-note', addNote);
    emitter.on('new-folder', addFolder);
    emitter.on('open-settings', openSettings);
    emitter.on('dark', enableDarkTheme);
    emitter.on('light', enableLightTheme);

    let _unregSidebarShortcuts;
    onMounted(() => {
      _unregSidebarShortcuts = bindGlobalShortcuts(
        createShortcutMap({
          'mod+shift+l': () =>
            theme.setTheme(theme.isDark() ? 'light' : 'dark'),
          'mod+shift+y': () => manualSync(),
        })
      );
    });
    onUnmounted(() => _unregSidebarShortcuts?.());

    onUnmounted(() => {
      emitter.off('new-note', addNote);
      emitter.off('new-folder', addFolder);
      emitter.off('open-settings', openSettings);
      emitter.off('dark', enableDarkTheme);
      emitter.off('light', enableLightTheme);

      // CRITICAL FIX: Safe memory leak cleanup
      if (typeof window !== 'undefined' && window.addNote) {
        delete window.addNote;
      }
    });

    function manualSync() {
      if (spinning.value) return;
      spinning.value = true;
      forceSyncNow();
      setTimeout(() => {
        spinning.value = false;
        play('sync');
      }, 1000);
    }

    return {
      expanded,
      toggleExpanded,
      isAllNotesActive,
      isArchiveActive,

      isSettingsActive,
      pillStyle,
      footerPillStyle,
      homeBtn,
      archiveBtn,

      settingsBtn,
      recentItems,
      formatRelativeTime,
      openFolder,
      goHome,
      goArchive,

      openNote,
      titlebarInset,
      translations,
      theme,
      spinning,
      addNote,
      addFolder,
      manualSync,
      keyBinding,
      folderStore,
    };
  },
};
</script>

<style scoped>
.scrollbar-none {
  scrollbar-width: none;
}
.scrollbar-none::-webkit-scrollbar {
  display: none;
}

.fade-fast-enter-active,
.fade-fast-leave-active {
  transition: opacity 0.2s var(--ease-standard);
}
.fade-fast-enter-from,
.fade-fast-leave-to {
  opacity: 0;
}

@media print {
  .no-print {
    display: none !important;
  }
}
</style>
