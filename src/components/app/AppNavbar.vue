<template>
  <nav class="w-full" data-selection-keep>
    <div class="mx-auto flex max-w-[32rem] items-end gap-3 justify-between">
      <!-- ── Left Rail ── -->
      <div
        class="flex items-center rounded-full bg-white dark:bg-neutral-800 border p-1.5 text-neutral-500 shadow-xl backdrop-blur-[18px] dark:text-neutral-300 dark:shadow-xl transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] overflow-hidden"
        :class="railWidthClass"
      >
        <!-- Default Navigation -->
        <div
          v-if="!showAddMenu && !selectionBar.hasSelection"
          ref="navRailRef"
          class="relative flex items-center gap-1.5 w-full"
        >
          <div
            class="pointer-events-none absolute inset-y-0 rounded-full bg-primary/15 ring-1 ring-white/60 transition-[transform,width,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] dark:bg-primary/20 dark:ring-white/10"
            :style="activePillStyle"
          />
          <button
            v-for="nav in navItems"
            :key="nav.name"
            :ref="(el) => setNavItemRef(nav.path, el)"
            v-tooltip:right="
              `${nav.name} (${nav.shortcut.replace('mod', keyBinding)})`
            "
            :data-testid="getNavTestId(nav.path)"
            class="relative z-10 flex h-12 w-16 items-center justify-center rounded-full text-inherit transition-[color,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.97]"
            :class="{
              'text-primary': isActivePath(nav.path),
            }"
            @click="handleNavigation(nav)"
          >
            <v-remixicon :name="nav.icon" size="22" />
          </button>
        </div>

        <!-- Add Menu -->
        <div
          v-else-if="showAddMenu && !selectionBar.hasSelection"
          class="flex items-center justify-around w-full"
        >
          <button
            v-tooltip:right="translations.sidebar.newFolder || 'New Folder'"
            class="flex h-12 w-16 items-center justify-center rounded-full text-neutral-600 dark:text-neutral-400 hover:text-primary transition-colors duration-200"
            @click="addFolderAndClose"
          >
            <v-remixicon name="riFolderAddLine" size="22" />
          </button>
          <button
            v-tooltip:right="translations.sidebar.addNotes || 'New Note'"
            class="flex h-12 w-16 items-center justify-center rounded-full text-neutral-600 dark:text-neutral-400 hover:text-primary transition-colors duration-200"
            @click="addNoteAndClose"
          >
            <v-remixicon name="riFileAddLine" size="22" />
          </button>
        </div>

        <!-- Selection Actions -->
        <div
          v-else-if="selectionBar.hasSelection"
          class="flex items-center justify-between w-full"
        >
          <span class="text-xs font-medium text-neutral-500 px-2 select-none">
            {{ selectionBar.selectedCount }}
            {{ selectionBar.selectedCount === 1 ? 'item' : 'items' }}
          </span>
          <div class="flex items-center">
            <button
              v-if="selectionBar.hasSelectedNotes"
              v-tooltip:right="
                selectionBar.shouldLock
                  ? translations.card.lock || 'Lock'
                  : translations.card.unlock || 'Unlock'
              "
              class="flex h-12 w-12 items-center justify-center rounded-full text-neutral-400 hover:text-amber-600 transition-colors duration-200"
              @click="selectionBar.toggleLock()"
            >
              <v-remixicon
                :name="
                  selectionBar.shouldLock ? 'riLockLine' : 'riLockUnlockLine'
                "
                size="20"
              />
            </button>
            <button
              v-if="selectionBar.hasSelectedNotes"
              v-tooltip:right="
                selectionBar.shouldBookmark
                  ? translations.card.bookmark || 'Bookmark'
                  : translations.card.removeBookmark || 'Unbookmark'
              "
              class="flex h-12 w-12 items-center justify-center rounded-full transition-colors duration-200"
              :class="
                selectionBar.shouldBookmark
                  ? 'text-neutral-400 hover:text-amber-500'
                  : 'text-amber-500'
              "
              @click="selectionBar.toggleBookmark()"
            >
              <v-remixicon
                :name="
                  selectionBar.shouldBookmark
                    ? 'riBookmarkLine'
                    : 'riBookmarkFill'
                "
                size="20"
              />
            </button>
            <button
              v-tooltip:right="
                selectionBar.shouldArchive
                  ? translations.card.archive || 'Archive'
                  : translations.card.unarchive || 'Unarchive'
              "
              class="flex h-12 w-12 items-center justify-center rounded-full text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors duration-200"
              @click="selectionBar.toggleArchive()"
            >
              <v-remixicon
                :name="
                  selectionBar.shouldArchive
                    ? 'riArchiveDrawerLine'
                    : 'riInboxUnarchiveLine'
                "
                size="20"
              />
            </button>
            <button
              v-tooltip:right="translations.card.moveToFolder || 'Move'"
              class="flex h-12 w-12 items-center justify-center rounded-full text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors duration-200"
              @click="handleMoveSelection"
            >
              <v-remixicon name="riFolderTransferLine" size="20" />
            </button>
            <button
              v-tooltip:right="translations.card.delete || 'Delete'"
              class="flex h-12 w-12 items-center justify-center rounded-full text-red-500 hover:bg-red-500/10 transition-colors duration-200"
              @click="handleDeleteSelection"
            >
              <v-remixicon name="riDeleteBin6Line" size="20" />
            </button>
            <button
              v-tooltip:right="translations.index.close || 'Close'"
              class="flex h-12 w-12 items-center justify-center rounded-full text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors duration-200"
              @click="handleClearSelection"
            >
              <v-remixicon name="riCloseLine" size="20" />
            </button>
          </div>
        </div>
      </div>

      <!-- Right Button -->
      <div v-if="!selectionBar.hasSelection" class="relative flex-shrink-0">
        <button
          v-tooltip:right="
            showAddMenu
              ? translations.index.close || 'Close'
              : translations.sidebar.addNotes + ' (' + keyBinding + '+N)'
          "
          data-testid="add-note-button"
          class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-lg transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-primary/90 dark:bg-primary/90 dark:hover:bg-primary/100"
          :class="{ 'rotate-40 scale-95': showAddMenu }"
          @click="toggleAddMenu"
        >
          <v-remixicon
            :name="showAddMenu ? 'riCloseLine' : 'riAddFill'"
            size="24"
          />
        </button>
      </div>
    </div>
  </nav>
</template>

<script>
import {
  computed,
  onMounted,
  onUnmounted,
  ref,
  reactive,
  watch,
  nextTick,
} from 'vue';
import emitter from 'tiny-emitter/instance';
import { useRoute } from 'vue-router';
import { useGlobalShortcuts } from '@/composable/useGlobalShortcuts';
import { useAppShellActions } from '@/composable/useAppShellActions';
import { useSelectionBar } from '@/composable/useSelectionBar';
import { useDialog } from '@/composable/dialog';

export default {
  setup() {
    const route = useRoute();
    const {
      translations,
      navItems,
      addNote,
      addFolder,
      openSettings,
      openLastEdited,
      handleNavigation,
      createShortcutMap,
    } = useAppShellActions({ includeSettingsNav: true });
    const isMacOS = navigator.platform.toUpperCase().includes('MAC');
    const keyBinding = isMacOS ? 'Cmd' : 'Ctrl';
    const navRailRef = ref(null);
    const navItemRefs = new Map();
    const activePill = reactive({
      width: 0,
      x: 0,
      visible: false,
    });
    const showAddMenu = ref(false);
    const selectionBar = reactive(useSelectionBar());

    // ── Rail width ──
    const railWidthClass = computed(() => {
      if (selectionBar.hasSelection) return 'flex-1 min-w-0';
      if (showAddMenu.value) return 'w-[156px]';
      return 'w-[216px]';
    });

    // ── Emitter listeners ──
    emitter.on('new-note', addNote);
    emitter.on('new-folder', addFolder);
    emitter.on('open-settings', openSettings);

    if (typeof window !== 'undefined') {
      window.addNote = addNote;
    }

    useGlobalShortcuts(() => createShortcutMap());

    // ── Close add menu when clicking outside ──
    function onDocumentClick(event) {
      if (!showAddMenu.value) return;
      // Ignore clicks inside the navbar
      const navbarEl = event.target.closest('[data-selection-keep]');
      if (navbarEl) return;
      showAddMenu.value = false;
    }

    // ── Add menu ──
    function toggleAddMenu() {
      showAddMenu.value = !showAddMenu.value;
    }

    function addNoteAndClose() {
      showAddMenu.value = false;
      addNote();
    }

    function addFolderAndClose() {
      showAddMenu.value = false;
      addFolder();
    }

    // ── Selection actions ──
    function handleClearSelection() {
      selectionBar.clearSelection();
    }

    function handleDeleteSelection() {
      const performed = selectionBar.deleteSelection();
      if (!performed) {
        const t = translations.value || {};
        useDialog().alert({
          title: t.dialog?.notice || 'Notice',
          body:
            t.card?.noActionAvailable ||
            'No items selected. Please go to your notes first.',
          okText: t.dialog?.close || 'Close',
        });
      }
    }

    function handleMoveSelection() {
      const performed = selectionBar.moveSelection();
      if (!performed) {
        const t = translations.value || {};
        useDialog().alert({
          title: t.dialog?.notice || 'Notice',
          body:
            t.card?.noActionAvailable ||
            'No items selected. Please go to your notes first.',
          okText: t.dialog?.close || 'Close',
        });
      }
    }

    // ── Active pill ──
    onMounted(() => {
      document.addEventListener('click', onDocumentClick, true);
      window.addEventListener('resize', updateActivePill);
      void updateActivePill();
    });

    onUnmounted(() => {
      document.removeEventListener('click', onDocumentClick, true);
      emitter.off('new-note', addNote);
      emitter.off('new-folder', addFolder);
      emitter.off('open-settings', openSettings);
      window.removeEventListener('resize', updateActivePill);
      navItemRefs.clear();
    });

    watch(
      () => route.fullPath,
      (newPath) => {
        // Browser pages where the selection bar is valid:
        //   /                 (notes index)
        //   /?archived=true   (archive)
        //   /folder/:id       (folder detail)
        // Navigating to any other page (settings, note detail, etc.)
        // should clear the selection so stale handlers can't be invoked.
        const isBrowserPage =
          newPath === '/' ||
          newPath === '/?archived=true' ||
          newPath.startsWith('/folder/');

        if (!isBrowserPage && selectionBar.hasSelection) {
          selectionBar.clearSelection();
        }

        void updateActivePill();
      },
      { flush: 'post' }
    );

    watch(
      navItems,
      () => {
        void updateActivePill();
      },
      { flush: 'post' }
    );

    function getActiveNavPath() {
      if (route.path.startsWith('/settings')) return '/settings';
      if (route.query.archived === 'true') return '/?archived=true';
      return '/';
    }

    function isActivePath(path) {
      return getActiveNavPath() === path;
    }

    function setNavItemRef(path, element) {
      if (!element) {
        navItemRefs.delete(path);
        return;
      }
      navItemRefs.set(path, element);
    }

    async function updateActivePill() {
      await nextTick();

      const activePath = getActiveNavPath();
      const activeElement = activePath ? navItemRefs.get(activePath) : null;
      const railElement = navRailRef.value;

      if (!activeElement || !railElement) {
        activePill.visible = false;
        return;
      }

      activePill.width = activeElement.offsetWidth;
      activePill.x = activeElement.offsetLeft;
      activePill.visible = true;
    }

    const activePillStyle = computed(() => ({
      width: `${activePill.width}px`,
      transform: `translate3d(${activePill.x}px, 0, 0)`,
      opacity: activePill.visible ? 1 : 0,
    }));

    function getNavTestId(path) {
      if (path === '/') return 'nav-notes-button';
      if (path === '/?archived=true') return 'nav-archive-button';
      return null;
    }

    return {
      navItems,
      translations,
      addNote,
      addFolder,
      openLastEdited,
      keyBinding,
      handleNavigation,
      getNavTestId,
      isActivePath,
      setNavItemRef,
      navRailRef,
      activePillStyle,
      showAddMenu,
      toggleAddMenu,
      addNoteAndClose,
      addFolderAndClose,
      selectionBar,
      railWidthClass,
      handleClearSelection,
      handleDeleteSelection,
      handleMoveSelection,
    };
  },
};
</script>
