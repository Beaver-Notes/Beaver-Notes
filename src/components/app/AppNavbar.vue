<template>
  <nav class="fixed inset-x-0 z-40 flex justify-center px-4 no-print bottom-0">
    <div class="flex max-w-[32rem] items-end gap-3">
      <div
        class="flex items-center rounded-full border border-white/45 bg-white/75 p-1.5 text-neutral-500 shadow-xl backdrop-blur-[18px] dark:border-white/10 dark:bg-neutral-900/80 dark:text-neutral-300 dark:shadow-xl"
      >
        <div class="flex items-center gap-1.5">
          <button
            v-tooltip:right="
              translations.sidebar.editedNote + ' (' + keyBinding + '+Shift+W)'
            "
            class="flex h-[2.9rem] w-[2.9rem] items-center justify-center rounded-full text-inherit transition-[background-color,color,transform] duration-200 ease-out active:bg-white/50 active:text-neutral-900 dark:active:bg-white/10 dark:active:text-neutral-100"
            :class="{
              'bg-primary/15 text-primary dark:bg-primary/20':
                $route.name === 'Note',
            }"
            @click="openLastEdited"
          >
            <v-remixicon name="riEditLine" size="22" />
          </button>

          <button
            v-for="nav in navs"
            :key="nav.name"
            v-tooltip:right="
              `${nav.name} (${nav.shortcut.replace('mod', keyBinding)})`
            "
            :data-testid="getNavTestId(nav.path)"
            class="flex h-[2.9rem] w-[2.9rem] items-center justify-center rounded-full text-inherit transition-[background-color,color,transform] duration-200 ease-out active:bg-white/50 active:text-neutral-900 dark:active:bg-white/10 dark:active:text-neutral-100"
            :class="{
              'bg-primary/15 text-primary dark:bg-primary/20':
                $route.fullPath === nav.path,
            }"
            @click="handleNavigation(nav)"
          >
            <v-remixicon :name="nav.icon" size="22" />
          </button>

          <router-link
            v-tooltip:right="
              translations.settings.title + ' (' + keyBinding + '+,)'
            "
            to="/settings"
            class="flex h-[2.9rem] w-[2.9rem] items-center justify-center rounded-full text-inherit transition-[background-color,color,transform] duration-200 ease-out active:bg-white/50 active:text-neutral-900 dark:active:bg-white/10 dark:active:text-neutral-100"
            :class="{
              'bg-primary/15 text-primary dark:bg-primary/20':
                $route.path === '/settings',
            }"
          >
            <v-remixicon name="riSettingsLine" size="22" />
          </router-link>
        </div>
      </div>
      <button
        v-tooltip:right="
          translations.sidebar.addNotes + ' (' + keyBinding + '+N)'
        "
        data-testid="add-note-button"
        class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-lg transition-all hover:bg-primary/90 dark:bg-primary/50 dark:hover:bg-primary/60"
        @click="addNote"
      >
        <v-remixicon name="riAddFill" size="24" />
      </button>
    </div>
  </nav>
</template>

<script>
import { shallowReactive, onMounted, onUnmounted, computed, ref } from 'vue';
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

    const state = shallowReactive({
      dataDir: '',
      password: '',
      fontSize: '16',
      withPassword: false,
      lastUpdated: null,
    });

    const navs = computed(() => [
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

      folderStore.add({ parentId }).then(({ id }) => {
        console.log(`${id}`);
      });
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
    });

    onUnmounted(() => {
      emitter.off('new-note', addNote);
      emitter.off('new-folder', addFolder);
      emitter.off('open-settings', openSettings);
      removeGlobalShortcuts();
      state.dataDir = defaultPath;
    });

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
      navs,
      translations,
      currentFolderId,
      addNote,
      addFolder,
      noteStore,
      openLastEdited,
      keyBinding,
      handleNavigation,
      getNavTestId,
    };
  },
};
</script>
