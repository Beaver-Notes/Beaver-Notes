<template>
  <aside
    class="w-16 text-gray-600 dark:text-gray-200 bg-[#F8F8F7] dark:bg-[#353333] fixed text-center flex flex-col items-center h-full left-0 top-0 z-40 py-4 no-print"
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
      class="transition dark:hover:text-white hover:text-gray-800 p-2 mb-4"
      :class="{ 'text-primary': $route.name === 'Note' }"
      @click="openLastEdited"
    >
      <v-remixicon name="riEditLine" />
    </button>
    <router-link
      v-for="nav in navs"
      :key="nav.name"
      v-tooltip:right="
        `${nav.name} (${nav.shortcut.replace('mod', keyBinding)})`
      "
      :to="nav.path"
      :class="{
        'text-primary dark:text-secondary': $route.fullPath === nav.path,
      }"
      class="transition dark:hover:text-white hover:text-gray-800 p-2 mb-4"
    >
      <v-remixicon :name="nav.icon" />
    </router-link>
    <!-- Navbar bottom icons -->
    <div class="flex-grow"></div>
    <button
      v-tooltip:right="
        translations.sidebar.toggleexport + ' (' + keyBinding + '+Shift+E)'
      "
      class="transition p-2 mb-4"
      @click="exportData"
    >
      <v-remixicon name="riUpload2Line" />
    </button>
    <button
      v-tooltip:right="
        translations.sidebar.toggleimport + ' (' + keyBinding + '+Shift+I)'
      "
      class="transition p-2 mb-4"
      @click="importData"
    >
      <v-remixicon name="riDownload2Line" />
    </button>
    <button
      v-tooltip:right="
        translations.sidebar.toggledarktheme + ' (' + keyBinding + '+Shift+L)'
      "
      :class="[
        theme.isDark()
          ? 'text-primary dark:text-secondary'
          : 'dark:hover:text-white hover:text-gray-800',
      ]"
      class="transition p-2 mb-4"
      @click="theme.setTheme(theme.isDark() ? 'light' : 'dark')"
    >
      <v-remixicon :name="theme.isDark() ? 'riSunLine' : 'riMoonClearLine'" />
    </button>
    <router-link
      v-tooltip:right="translations.settings.title + ' (' + keyBinding + '+,)'"
      to="/settings"
      class="transition dark:hover:text-white hover:text-gray-800 p-2"
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
import { useStorage } from '@/composable/storage';
import { AES } from 'crypto-es/lib/aes';
import { Utf8 } from 'crypto-es/lib/core';
import dayjs from '@/lib/dayjs';

export default {
  setup() {
    const { ipcRenderer, path } = window.electron;
    const theme = useTheme();
    const router = useRouter();
    const noteStore = useNoteStore();
    const storage = useStorage();
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
      },
      {
        name: translations.sidebar.Archive,
        path: '/?archived=true',
        icon: 'riArchiveDrawerLine',
        shortcut: 'mod+shift+a',
      },
    ]);

    const shortcuts = {
      'mod+n': addNote,
      'mod+,': openSettings,
      'mod+shift+w': openLastEdited,
      'mod+shift+n': () => router.push('/'),
      'mod+shift+a': () => router.push('/?archived=true'),
      'mod+shift+l': () => theme.setTheme(theme.isDark() ? 'light' : 'dark'),
      'mod+shift+u': importData,
      'mod+shift+e': exportData,
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

    async function exportData() {
      try {
        let data = await storage.store();

        if (state.withPassword) {
          data = AES.encrypt(JSON.stringify(data), state.password).toString();
        }

        const folderName = dayjs().format('[Beaver Notes] YYYY-MM-DD');
        const dataDir = await storage.get('dataDir', '', 'settings');

        const exportPath = defaultPath; // Use the selected default path
        const folderPath = path.join(exportPath, folderName);

        await ipcRenderer.callMain('fs:ensureDir', folderPath);
        await ipcRenderer.callMain('fs:output-json', {
          path: path.join(folderPath, 'data.json'),
          data: { data },
        });
        await ipcRenderer.callMain('fs:copy', {
          path: path.join(dataDir, 'notes-assets'),
          dest: path.join(folderPath, 'assets'),
        });

        state.withPassword = false;
        state.password = '';
      } catch (error) {
        console.error(error);
      }
    }

    async function mergeImportedData(data) {
      try {
        const keys = [
          { key: 'notes', dfData: {} },
          { key: 'labels', dfData: [] },
        ];

        for (const { key, dfData } of keys) {
          const currentData = await storage.get(key, dfData);
          const importedData = data[key] ?? dfData;
          let mergedData;

          if (key === 'labels') {
            const mergedArr = [...currentData, ...importedData];

            mergedData = [...new Set(mergedArr)];
          } else {
            mergedData = { ...currentData, ...importedData };
          }

          await storage.set(key, mergedData);
        }

        window.location.reload();
      } catch (error) {
        console.error(error);
      }
    }

    async function importData() {
      try {
        const today = dayjs();
        const folderName = today.format('[Beaver Notes] YYYY-MM-DD');
        const dirPath = path.join(defaultPath, folderName);

        let { data } = await ipcRenderer.callMain(
          'fs:read-json',
          path.join(dirPath, 'data.json')
        );

        if (typeof data === 'string') {
          const password = 'userInputPassword'; // Replace with your logic to get the password

          const bytes = AES.decrypt(data, password);
          const result = bytes.toString(Utf8);
          const resultObj = JSON.parse(result);

          mergeImportedData(resultObj);
        } else {
          mergeImportedData(data);
        }

        const dataDir = await storage.get('dataDir', '', 'settings');
        const importPathToAssets = path.join(dirPath, 'assets');

        await ipcRenderer.callMain('fs:copy', {
          path: importPathToAssets,
          dest: path.join(dataDir, 'notes-assets'),
        });

        console.log('Assets copied successfully.');
      } catch (error) {
        console.error('Error while importing data:', error);
      }
    }

    console.log('Default path from local storage:', defaultPath);

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
      },
      settings: {
        title: 'settings.title',
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

    return {
      navs,
      translations,
      theme,
      addNote,
      noteStore,
      openLastEdited,
      keyBinding,
      exportData,
      importData,
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
