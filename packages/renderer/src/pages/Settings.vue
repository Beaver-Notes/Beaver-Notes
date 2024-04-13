<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="container py-6">
    <h1 class="text-3xl mb-10 font-bold">
      {{ translations.settings.title || '-' }}
    </h1>
    <div class="flex">
      <div class="w-64">
        <ui-list
          class="space-y-1 sticky top-10 ltr:mr-8 rtl:ml-8 rounded-lg dark:text-gray-200 text-gray-600"
        >
          <router-link
            v-for="(item, id) in settings"
            v-slot="{ isExactActive }"
            :key="id"
            :to="item.path"
            class="block"
          >
            <ui-list-item :active="isExactActive" class="cursor-pointer">
              <v-remixicon :name="item.icon" class="ltr:mr-2 rtl:ml-2 -ml-1" />
              {{ item.name }}
            </ui-list-item>
          </router-link>
        </ui-list>
      </div>
      <router-view />
    </div>
  </div>
</template>
<script setup>
import { onMounted, shallowReactive, computed } from 'vue';

const settings = computed(() => ({
  Settings: {
    name: translations.settings.General,
    icon: 'riWindowLine',
    path: '/settings',
    description: '',
  },
  'Settings-Shortcuts': {
    name: translations.settings.Shortcuts,
    icon: 'riKeyboardLine',
    path: '/settings/shortcuts',
    description: '',
  },
  'Settings-About': {
    name: translations.settings.About,
    icon: 'riInformationLine',
    path: '/settings/about',
    description: '',
  },
}));

const translations = shallowReactive({
  settings: {
    title: 'settings.title',
    General: 'settings.General',
    Shortcuts: 'settings.Shortcuts',
    About: 'settings.About',
  },
});

onMounted(async () => {
  const loadedTranslations = await loadTranslations();
  if (loadedTranslations) {
    Object.assign(translations, loadedTranslations);
  }
});

const loadTranslations = async () => {
  const selectedLanguage = localStorage.getItem('selectedLanguage') || 'en';
  try {
    const translationModule = await import(
      `./settings/locales/${selectedLanguage}.json`
    );
    return translationModule.default;
  } catch (error) {
    console.error('Error loading translations:', error);
    return null;
  }
};
</script>
