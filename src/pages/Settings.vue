<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div
    class="container py-6 mobile:px-4 mobile:pb-[calc(var(--app-mobile-content-offset)+1.5rem)]"
  >
    <h1 class="text-3xl mb-10 font-bold mobile:hidden">
      {{ pageTitle }}
    </h1>
    <div class="flex mobile:hidden">
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

    <div class="hidden mobile:block">
      <div class="mb-5 space-y-1">
        <p
          class="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400"
        >
          {{ translations.settings.title || 'Settings' }}
        </p>
        <h1 class="text-3xl font-bold text-neutral-900 dark:text-neutral-100">
          {{ pageTitle }}
        </h1>
      </div>

      <div
        ref="mobileHeaderRef"
        class="settings-mobile-header sticky z-[200] -mx-4 mb-6 bg-neutral-50 px-4 py-3 top-0"
        :style="mobileHeaderStyle"
      >
        <div class="flex gap-2 overflow-x-auto no-scrollbar">
          <router-link
            v-for="(item, id) in mobileSettings"
            v-slot="{ isExactActive }"
            :key="id"
            :to="item.path"
            class="shrink-0"
          >
            <div
              class="flex min-w-max items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors"
              :class="
                isExactActive
                  ? 'border-primary bg-primary text-white'
                  : 'border-neutral-200 bg-white text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
              "
            >
              <v-remixicon :name="item.icon" />
              <span>{{ item.name }}</span>
            </div>
          </router-link>
        </div>
      </div>

      <router-view />
    </div>
  </div>
</template>
<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useTranslations } from '@/composable/useTranslations.js';

const { translations } = useTranslations();
const route = useRoute();
const mobileHeaderRef = ref(null);
const isMobileHeaderStuck = ref(false);

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

const mobileSettings = computed(() =>
  Object.fromEntries(
    Object.entries(settings.value).filter(
      ([key]) => key !== 'Settings-Shortcuts'
    )
  )
);

const pageTitle = computed(() => {
  if (route.name === 'index') return settings.value.Settings.name;
  return settings.value[route.name]?.name || '-';
});

const mobileHeaderStyle = computed(() => ({
  paddingTop: isMobileHeaderStuck.value
    ? 'calc(var(--app-safe-area-top))'
    : undefined,
}));

function syncStickyState() {
  if (typeof window === 'undefined' || !mobileHeaderRef.value) return;

  const { top } = mobileHeaderRef.value.getBoundingClientRect();
  isMobileHeaderStuck.value = top <= 0;
}

onMounted(() => {
  syncStickyState();
  window.addEventListener('scroll', syncStickyState, { passive: true });
  window.addEventListener('resize', syncStickyState, { passive: true });
});

onUnmounted(() => {
  window.removeEventListener('scroll', syncStickyState);
  window.removeEventListener('resize', syncStickyState);
});
</script>

<style scoped>
.settings-mobile-header {
  transition: padding-top 180ms ease, box-shadow 180ms ease,
    background-color 180ms ease;
  @apply border-y border-neutral-200 shadow-sm dark:border-neutral-800 dark:bg-neutral-900;
}
</style>
