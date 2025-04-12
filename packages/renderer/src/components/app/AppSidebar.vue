<template>
  <aside
    class="w-16 text-gray-600 dark:text-[color:var(--selected-dark-text)] bg-[#F8F8F7] dark:bg-[#353333] fixed text-center flex flex-col items-center h-full left-0 top-0 z-40 py-4 no-print"
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
        translations.sidebar.Editednote + ' (' + keyBinding + '+Shift+W)'
      "
      class="transition dark:hover:text-[color:var(--selected-dark-text)] hover:text-gray-800 p-2 mb-4"
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
      class="transition dark:hover:text-[color:var(--selected-dark-text)] hover:text-gray-800 p-2 mb-4"
      @click="handleNavigation(nav)"
    >
      <v-remixicon :name="nav.icon" />
    </button>
    <!-- Navbar bottom icons -->
    <div class="flex-grow"></div>
    <button
      v-tooltip:right="
        translations.sidebar.toggledarktheme + ' (' + keyBinding + '+Shift+L)'
      "
      :class="[theme.isDark() ? 'text-primary' : '']"
      class="transition p-2 mb-4"
      @click="theme.setTheme(theme.isDark() ? 'light' : 'dark')"
    >
      <v-remixicon :name="theme.isDark() ? 'riSunLine' : 'riMoonClearLine'" />
    </button>
    <router-link
      v-tooltip:right="translations.settings.title + ' (' + keyBinding + '+,)'"
      to="/settings"
      class="transition dark:hover:text-[color:var(--selected-dark-text)] hover:text-gray-800 p-2"
      active-class="text-primary dark:text-secondary"
    >
      <v-remixicon name="riSettingsLine" />
    </router-link>
  </aside>
</template>

<script>
import { shallowReactive, onUnmounted, onMounted, computed } from 'vue';
import { useTheme } from '@/composable/theme';
import { useRouter } from 'vue-router';
import emitter from 'tiny-emitter/instance';
import Mousetrap from '@/lib/mousetrap';
import { useNoteStore } from '@/store/note';

export default {
  setup() {
    const theme = useTheme();
    const router = useRouter();
    const noteStore = useNoteStore();
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
        name: translations.sidebar.Notes,
        path: '/',
        icon: 'riBookletLine',
        shortcut: 'mod+shift+n',
        action: () => {
          router.push('/');
        },
      },
      {
        name: translations.sidebar.Archive,
        path: '/?archived=true',
        icon: 'riArchiveDrawerLine',
        shortcut: 'mod+shift+a',
        action: () => {
          router.push('/?archived=true');
        },
      },
    ]);

    const shortcuts = {
      'mod+n': addNote,
      'mod+,': openSettings,
      'mod+shift+w': openLastEdited,
      'mod+shift+n': () => router.push('/'),
      'mod+shift+a': () => router.push('/?archived=true'),
      'mod+shift+l': () => theme.setTheme(theme.isDark() ? 'light' : 'dark'),
    };

    emitter.on('new-note', addNote);
    emitter.on('open-settings', openSettings);

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

    if (typeof window !== 'undefined') {
      window.addNote = addNote;
    }

    onUnmounted(() => {
      emitter.off('new-note', addNote);
      emitter.off('open-settings', openSettings);
      state.dataDir = defaultPath;
    });

    const translations = shallowReactive({
      sidebar: {
        addNotes: 'sidebar.addNotes',
        Editednote: 'sidebar.Editednote',
        toggleexport: 'sidebar.toggleexport',
        toggleimport: 'sidebar.toggleimport',
        toggledarktheme: 'sidebar.toggledarktheme',
        Notes: 'sidebar.Notes',
        Archive: 'sidebar.Archive',
        notification: 'sidebar.notification',
        exportSuccess: 'sidebar.exportSuccess',
        importSuccess: 'sidebar.importSuccess',
        exportFail: 'sidebar.exportFail',
        importFail: 'sidebar.importFail',
      },
      settings: {
        title: 'settings.title',
        Inputpassword: 'settings.Inputpassword',
        body: 'settings.body',
        Import: 'settings.Import',
        Cancel: 'settings.Cancel',
        Password: 'settings.Password',
        invaliddata: 'settings.invaliddata',
        Invalidpassword: 'settings.Invalidpassword',
      },
    });

    onMounted(async () => {
      // Load translations
      const loadedTranslations = await loadTranslations();
      if (loadedTranslations) {
        Object.assign(translations, loadedTranslations);
      }
    });

    const loadTranslations = async () => {
      const selectedLanguage = localStorage.getItem('selectedLanguage') || 'en';
      try {
        const translationModule = await import(
          `../../pages/settings/locales/${selectedLanguage}.json`
        );
        return translationModule.default;
      } catch (error) {
        console.error('Error loading translations:', error);
        return null;
      }
    };

    const handleNavigation = async (nav) => {
      router.push(nav.path);
    };

    return {
      navs,
      translations,
      theme,
      addNote,
      noteStore,
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
