<template>
  <nav class="w-full">
    <div class="mx-auto flex max-w-[32rem] items-end gap-3 justify-between">
      <div
        class="flex items-center rounded-full border bg-white/75 p-1.5 text-neutral-500 shadow-xl backdrop-blur-[18px] dark:bg-neutral-900/80 dark:text-neutral-300 dark:shadow-xl"
      >
        <div ref="navRailRef" class="relative flex items-center gap-1.5">
          <div
            class="pointer-events-none absolute inset-y-0 rounded-full bg-primary/15 shadow-[0_10px_30px_rgba(15,23,42,0.08)] ring-1 ring-white/60 transition-[transform,width,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] dark:bg-primary/20 dark:ring-white/10"
            :style="activePillStyle"
          />
          <button
            v-for="nav in navItems"
            :key="nav.name"
            :ref="(element) => setNavItemRef(nav.path, element)"
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
      </div>
      <button
        v-tooltip:right="
          translations.sidebar.addNotes + ' (' + keyBinding + '+N)'
        "
        data-testid="add-note-button"
        class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-lg transition-all hover:bg-primary/90 dark:bg-primary/90 dark:hover:bg-primary/100"
        @click="addNote"
      >
        <v-remixicon name="riAddFill" size="24" />
      </button>
    </div>
  </nav>
</template>

<script>
import {
  shallowReactive,
  onMounted,
  onUnmounted,
  computed,
  ref,
  reactive,
  watch,
  nextTick,
} from 'vue';
import { useTranslations } from '@/composable/useTranslations';
import { useRouter, useRoute } from 'vue-router';
import emitter from 'tiny-emitter/instance';
import { useNoteStore } from '@/store/note';
import { useFolderStore } from '../../store/folder';
import { useAppStore } from '../../store/app';
import { bindGlobalShortcuts } from '@/utils/global-shortcuts';

export default {
  setup() {
    const route = useRoute();
    const router = useRouter();
    const appStore = useAppStore();
    const noteStore = useNoteStore();
    const folderStore = useFolderStore();
    const { translations } = useTranslations();
    const defaultPath = localStorage.getItem('default-path');
    const isMacOS = navigator.platform.toUpperCase().includes('MAC');
    const keyBinding = isMacOS ? 'Cmd' : 'Ctrl';
    const navRailRef = ref(null);
    const navItemRefs = new Map();
    const activePill = reactive({
      width: 0,
      x: 0,
      visible: false,
    });

    const state = shallowReactive({
      dataDir: '',
      password: '',
      fontSize: '16',
      withPassword: false,
      lastUpdated: null,
    });

    const navItems = computed(() => [
      {
        name: translations.value.sidebar.notes,
        path: '/',
        icon: 'riBookletLine',
        shortcut: 'mod+Shift+N',
        action: () => router.push('/'),
      },
      {
        name: translations.value.sidebar.archive,
        path: '/?archived=true',
        icon: 'riArchiveDrawerLine',
        shortcut: 'mod+Shift+A',
        action: () => router.push('/?archived=true'),
      },
      {
        name: translations.value.settings.title,
        path: '/settings',
        icon: 'riSettingsLine',
        shortcut: 'mod+,',
        action: () => router.push('/settings'),
      },
    ]);

    const shortcuts = {
      'mod+n': addNote,
      'mod+,': openSettings,
      'mod+shift+f': addFolder,
      'mod+shift+w': openLastEdited,
      'mod+shift+n': () => router.push('/'),
      'mod+shift+a': () => router.push('/?archived=true'),
    };

    emitter.on('new-note', addNote);
    emitter.on('new-folder', addFolder);
    emitter.on('open-settings', openSettings);

    let removeGlobalShortcuts = () => {};

    function openSettings() {
      router.push('/settings');
    }

    function openLastEdited() {
      const noteId = localStorage.getItem('lastNoteEdit');
      if (noteId) router.push(`/note/${noteId}`);
    }

    const currentFolderId = computed(() =>
      route.name === 'Folder' ? route.params.id ?? null : null
    );

    async function addNote() {
      const folderId =
        currentFolderId.value &&
        (await folderStore.exists(currentFolderId.value))
          ? currentFolderId.value
          : null;

      noteStore.add({ folderId }).then(({ id }) => {
        if (appStore.setting.openAfterCreation) {
          const target = `/note/${id}`;
          if (router.currentRoute.value.path !== target) {
            router.push(target);
          }
        }
      });
    }

    async function addFolder() {
      const parentId =
        currentFolderId.value &&
        (await folderStore.exists(currentFolderId.value))
          ? currentFolderId.value
          : null;

      folderStore.add({ parentId });
    }

    if (typeof window !== 'undefined') {
      window.addNote = addNote;
    }

    onMounted(() => {
      removeGlobalShortcuts = bindGlobalShortcuts({
        ...shortcuts,
        'mod+shift+f': (_, combo) => {
          if (route.name === 'Note') return false;
          return shortcuts[combo]();
        },
      });

      void updateActivePill();
      window.addEventListener('resize', updateActivePill);
    });

    onUnmounted(() => {
      emitter.off('new-note', addNote);
      emitter.off('new-folder', addFolder);
      emitter.off('open-settings', openSettings);
      removeGlobalShortcuts();
      window.removeEventListener('resize', updateActivePill);
      navItemRefs.clear();
      state.dataDir = defaultPath;
    });

    watch(
      () => route.fullPath,
      () => {
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

    const handleNavigation = async (nav) => {
      router.push(nav.path);
      emitter.emit('clear-label');
    };

    function getNavTestId(path) {
      if (path === '/') return 'nav-notes-button';
      if (path === '/?archived=true') return 'nav-archive-button';
      return null;
    }

    return {
      navItems,
      translations,
      currentFolderId,
      addNote,
      addFolder,
      noteStore,
      openLastEdited,
      keyBinding,
      handleNavigation,
      getNavTestId,
      isActivePath,
      setNavItemRef,
      navRailRef,
      activePillStyle,
    };
  },
};
</script>
