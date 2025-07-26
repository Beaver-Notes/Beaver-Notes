<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="container py-6">
    <h1 class="text-3xl mb-10 font-bold">
      {{ translations.settings.title || '-' }}
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
import { onMounted, computed, ref } from 'vue';
import { useTranslation } from '@/composable/translations';

const settings = computed(() => ({
  Settings: {
    name: translations.value.settings.general,
    icon: 'riWindowLine',
    path: '/settings',
    description: '',
  },
  'Settings-Appearance': {
    name: translations.value.settings.appearance,
    icon: 'riBrush3Fill',
    path: '/settings/appearance',
    description: '',
  },
  'Settings-Shortcuts': {
    name: translations.value.settings.shortcuts,
    icon: 'riKeyboardLine',
    path: '/settings/shortcuts',
    description: '',
  },
  'Settings-Security': {
    name: translations.value.settings.privacySecurity,
    icon: 'riLockLine',
    path: '/settings/privacysecurity',
    description: '',
  },
  'Settings-About': {
    name: translations.value.settings.about,
    icon: 'riInformationLine',
    path: '/settings/about',
    description: '',
  },
}));

const translations = ref({
  settings: {},
});

onMounted(async () => {
  await useTranslation().then((trans) => {
    if (trans) {
      translations.value = trans;
    }
  });
});
</script>
