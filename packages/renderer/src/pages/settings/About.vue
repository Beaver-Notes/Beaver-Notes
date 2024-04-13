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
    <div class="mt-4">
      <div class="flex">
        <p class="w-32">{{ translations.about.versionLabel || '-' }}</p>
        <p>{{ state.version }}</p>
      </div>
    </div>
    <div class="mt-12 space-x-8 dark:text-gray-300 text-gray-600">
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

    return {
      state,
      links,
      translations,
    };
  },
};
</script>
