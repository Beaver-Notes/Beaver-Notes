<template>
  <aside
    class="w-16 text-neutral-600 dark:text-[color:var(--selected-dark-text)] bg-neutral-50 dark:bg-neutral-750 fixed text-center flex flex-col items-center h-full left-0 top-0 z-40 py-4 no-print"
  >
    <!-- Sidebar top icons-->
    <button
      v-tooltip:right="
        translations.sidebar.addNotes + ' (' + keyBinding + '+N)'
      "
      class="transition p-2 mb-4 text-primary bg-input rounded-lg"
      @click="addNote"
    >
      <v-remixicon name="riAddFill" />
    </button>
    <button
      v-tooltip:right="
        translations.sidebar.newFolder + ' (' + keyBinding + '+Shift+F)'
      "
      class="transition dark:hover:text-[color:var(--selected-dark-text)] hover:text-neutral-800 p-2 mb-4"
      @click="addFolder"
    >
      <v-remixicon name="riFolderAddLine" />
    </button>
    <button
      v-tooltip:right="
        translations.sidebar.editedNote + ' (' + keyBinding + '+Shift+W)'
      "
      class="transition dark:hover:text-[color:var(--selected-dark-text)] hover:text-neutral-800 p-2 mb-4"
      :class="{ 'text-primary': $route.name === 'Note' }"
      @click="openLastEdited"
    >
      <v-remixicon name="riEditLine" />
    </button>
    <button
      v-for="nav in navs"
      :key="nav.name"
      v-tooltip:right="
        `${nav.name} (${nav.shortcut.replace('mod', keyBinding)})`
      "
      :class="{
        'text-primary dark:text-secondary': $route.fullPath === nav.path,
      }"
      class="transition dark:hover:text-[color:var(--selected-dark-text)] hover:text-neutral-800 p-2 mb-4"
      @click="handleNavigation(nav)"
    >
      <v-remixicon :name="nav.icon" />
    </button>
    <!-- Navbar bottom icons -->
    <div class="flex-grow"></div>
    <button
      v-tooltip:right="
        translations.sidebar.toggleSync + ' (' + keyBinding + '+Shift+Y)'
      "
      :class="[spinning ? 'text-secondary' : '']"
      class="transition p-2 mb-4"
      @click="manualSync"
    >
      <v-remixicon
        name="riLoopRightLine"
        :class="spinning ? 'animate-spin' : ''"
      />
    </button>
    <button
      v-tooltip:right="
        translations.sidebar.toggleDarkTheme + ' (' + keyBinding + '+Shift+L)'
      "
      :class="[theme.isDark() ? 'text-secondary' : '']"
      class="transition p-2 mb-4"
      @click="theme.setTheme(theme.isDark() ? 'light' : 'dark')"
    >
      <v-remixicon :name="theme.isDark() ? 'riSunLine' : 'riMoonClearLine'" />
    </button>
    <router-link
      v-tooltip:right="translations.settings.title + ' (' + keyBinding + '+,)'"
      to="/settings"
      class="transition dark:hover:text-[color:var(--selected-dark-text)] hover:text-neutral-800 p-2"
      active-class="text-primary dark:text-secondary"
    >
      <v-remixicon name="riSettingsLine" />
    </router-link>
  </aside>
</template>

<script>
import { shallowReactive, onUnmounted, onMounted, computed, ref } from 'vue';
import { useTranslation } from '@/composable/translations';
import { useTheme } from '@/composable/theme';
import { useRouter } from 'vue-router';
import emitter from 'tiny-emitter/instance';
import Mousetrap from '@/lib/mousetrap';
import { useNoteStore } from '@/store/note';
import { useFolderStore } from '../../store/folder';
import { forceSyncNow } from '@/utils/sync';

export default {
  setup() {
    const spinning = ref(false);
    const theme = useTheme();
    const router = useRouter();
    const noteStore = useNoteStore();
    const folderStore = useFolderStore();
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
        action: () => {
          router.push('/');
        },
      },
      {
        name: translations.value.sidebar.archive,
        path: '/?archived=true',
        icon: 'riArchiveDrawerLine',
        shortcut: 'mod+Shift+A',
        action: () => {
          router.push('/?archived=true');
        },
      },
    ]);

    const shortcuts = {
      'mod+n': addNote,
      'mod+,': openSettings,
      'mod+shift+f': addFolder,
      'mod+shift+w': openLastEdited,
      'mod+shift+n': () => router.push('/'),
      'mod+shift+a': () => router.push('/?archived=true'),
      'mod+shift+l': () => theme.setTheme(theme.isDark() ? 'light' : 'dark'),
      'mod+shift+y': () => manualSync(),
    };

    emitter.on('new-note', addNote);
    emitter.on('new-folder', addFolder);
    emitter.on('open-settings', openSettings);
    emitter.on('dark', () => theme.setTheme('dark'));
    emitter.on('light', () => theme.setTheme('light'));

    Mousetrap.bind(Object.keys(shortcuts), (event, combo) => {
      shortcuts[combo]();
    });

    function openSettings() {
      router.push('/settings');
    }
    function openLastEdited() {
      const noteId = localStorage.getItem('lastNoteEdit');

      if (noteId) router.push(`/note/${noteId}`);
    }

    function addNote() {
      noteStore.add().then(({ id }) => {
        router.push(`/note/${id}`);
      });
    }

    function addFolder() {
      folderStore.add().then(({ id }) => {
        console.log(`${id}`);
      });
    }

    if (typeof window !== 'undefined') {
      window.addNote = addNote;
    }

    onUnmounted(() => {
      emitter.off('new-note', addNote);
      emitter.off('open-settings', openSettings);
      state.dataDir = defaultPath;
    });

    const translations = ref({
      sidebar: {},
      settings: {},
    });

    onMounted(async () => {
      await useTranslation().then((trans) => {
        if (trans) {
          translations.value = trans;
        }
      });
    });

    const handleNavigation = async (nav) => {
      router.push(nav.path);
    };

    function manualSync() {
      spinning.value = true;

      forceSyncNow();

      setTimeout(() => {
        spinning.value = false;
      }, 1000); // duration of spin animation
    }

    return {
      navs,
      translations,
      theme,
      spinning,
      addNote,
      addFolder,
      noteStore,
      manualSync,
      openLastEdited,
      keyBinding,
      handleNavigation,
    };
  },
};
</script>
<style>
@media print {
  .no-print {
    visibility: hidden;
  }
}
</style>
