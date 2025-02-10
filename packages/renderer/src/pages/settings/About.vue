<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="general w-full max-w-xl">
    <div class="overflow-hidden p-2 inline-block mb-4">
      <img src="../../assets/images/logo-transparent.png" class="w-24" />
    </div>
    <h1 class="font-semibold capitalize">
      {{ translations.about.title || '-' }}
    </h1>
    <p>{{ translations.about.description || '-' }}</p>
    <div class="mt-4 flex flex-col space-y-2">
      <div class="flex items-center">
        <p class="w-32">{{ translations.about.versionLabel || '-' }}</p>
        <p>{{ state.version }}</p>
        <ui-button class="ml-auto" @click="checkForUpdates">
          {{ translations.settings.checkUpdates || '-' }}
        </ui-button>
      </div>
    </div>
    <section class="space-y-4">
      <div class="flex items-center py-2 justify-between">
        <div>
          <span class="block text-lg align-left">
            {{ translations.settings.autoUpdate || '-' }}
          </span>
        </div>
        <label class="relative inline-flex cursor-pointer items-center">
          <input
            id="switch"
            v-model="autoUpdateEnabled"
            type="checkbox"
            class="peer sr-only"
            @change="toggleAutoUpdate"
          />
          <div
            class="peer h-6 w-11 rounded-full border bg-slate-200 dark:bg-[#353333] after:absolute after:left-[2px] rtl:after:right-[22px] after:top-0.5 after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-primary peer-checked:after:translate-x-full rtl:peer-checked:after:border-white peer-focus:ring-green-300"
          ></div>
        </label>
      </div>
      <div class="space-x-8 dark:text-gray-300 text-gray-600">
        <a
          v-for="link in links"
          :key="link.name"
          :href="link.url"
          target="_blank"
          class="dark:hover:text-white hover:text-gray-900 transition"
        >
          <v-remixicon :name="link.icon" />
          <span class="align-right ml-1">{{
            translations.about[link.name] || '-'
          }}</span>
        </a>
      </div>
    </section>
  </div>
</template>

<script>
import { onMounted, shallowReactive } from 'vue';

export default {
  setup() {
    const links = [
      {
        name: 'website',
        url: 'https://www.beavernotes.com',
        icon: 'riGlobalLine',
      },
      {
        name: 'github',
        url: 'https://github.com/Daniele-rolli/Beaver-Notes',
        icon: 'riGithubFill',
      },
      {
        name: 'donate',
        url: 'https://www.buymeacoffee.com/beavernotes',
        icon: 'riCupLine',
      },
    ];

    const state = shallowReactive({
      name: '-',
      version: '0.0.0',
      autoUpdateEnabled:
        localStorage.getItem('autoUpdateEnabled') !== null
          ? JSON.parse(localStorage.getItem('autoUpdateEnabled'))
          : true,
    });

    const translations = shallowReactive({
      about: {
        title: 'About.Title',
        description: 'About.Description',
        versionLabel: 'About.VersionLabel',
        website: 'Links.Website',
        github: 'Links.GitHub',
        donate: 'links.Donate',
      },
      settings: {
        autoUpdate: 'Settings.AutoUpdate',
        checkUpdates: 'Settings.CheckUpdates',
      },
    });

    onMounted(async () => {
      window.electron.ipcRenderer.callMain('app:info').then((data) => {
        Object.assign(state, data);
      });

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
          `./locales/${selectedLanguage}.json`
        );
        return translationModule.default;
      } catch (error) {
        console.error('Error loading translations:', error);
        return null;
      }
    };

    const checkForUpdates = () => {
      window.electron.ipcRenderer.callMain('check-for-updates');
    };

    const toggleAutoUpdate = async () => {
      state.autoUpdateEnabled = !state.autoUpdateEnabled;
      localStorage.setItem(
        'autoUpdateEnabled',
        JSON.stringify(state.autoUpdateEnabled)
      );
      await window.electron.ipcRenderer.callMain(
        'toggle-auto-update',
        state.autoUpdateEnabled
      );
    };

    onMounted(async () => {
      try {
        const autoUpdateStatus = await window.electron.ipcRenderer.callMain(
          'get-auto-update-status'
        );
        state.autoUpdateEnabled = autoUpdateStatus;
      } catch (error) {
        console.error('Error fetching auto-update status:', error);
      }
    });

    return {
      ...state,
      checkForUpdates,
      toggleAutoUpdate,
      state,
      links,
      translations,
    };
  },
};
</script>
