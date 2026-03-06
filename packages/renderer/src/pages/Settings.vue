<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="container py-6">
    <h1 class="text-3xl mb-10 font-bold">
      {{ pageTitle }}
    </h1>
    <div class="flex">
      <div class="w-64">
        <ui-list
          class="space-y-1 sticky top-10 ltr:mr-8 rtl:ml-8 rounded-lg dark:text-[color:var(--selected-dark-text)] text-gray-600"
        >
          <router-link
            v-for="(item, id) in settings"
            v-slot="{ isExactActive }"
            :key="id"
            :to="item.path"
            class="block"
          >
            <ui-list-item :active="isExactActive">
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
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useTranslations } from '@/composable/useTranslations.js';

const { translations } = useTranslations();
const route = useRoute();

const settings = computed(() => ({
  Settings: {
    name: translations.value.settings.general,
    icon: 'riWindowLine',
    path: '/settings',
  },
  'Settings-Appearance': {
    name: translations.value.settings.appearance,
    icon: 'riBrush3Fill',
    path: '/settings/appearance',
  },
  'Settings-Security': {
    name: translations.value.settings.security,
    icon: 'riShieldLine',
    path: '/settings/security',
  },

  'Settings-Labels': {
    name: translations.value.labels?.title || 'Labels',
    icon: 'riPriceTag3Line',
    path: '/settings/labels',
  },
  'Settings-Shortcuts': {
    name: translations.value.settings.shortcuts,
    icon: 'riKeyboardLine',
    path: '/settings/shortcuts',
  },
  'Settings-About': {
    name: translations.value.settings.about,
    icon: 'riInformationLine',
    path: '/settings/about',
  },
}));

const pageTitle = computed(() => {
  if (route.name === 'index') return settings.value.Settings.name;
  return settings.value[route.name]?.name || '-';
});
</script>

